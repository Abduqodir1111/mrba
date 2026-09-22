import { Query } from "@nestjs/common";
import { page, PageQuery } from "./pagination";
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Database } from "./db";
import { OperationsService } from "./operations";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { balancesLock, decimal, ensure, kg, lock, movement } from "./factory";
class CustomerDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}
class ContractLineDto {
  @IsUUID() itemId!: string;
  @IsString() @Matches(/^\d{1,12}$/) agreedQuantityKg!: string;
  @IsString() @Matches(/^\d{1,12}(?:\.\d{1,6})?$/) unitPricePerKg!: string;
}
class ContractDto {
  @IsString() @Matches(/\S/) @MaxLength(100) number!: string;
  @IsUUID() customerId!: string;
  @IsIn(["USD", "UZS"]) currency!: "USD" | "UZS";
  @IsOptional() @IsInt() @Min(1) plannedTruckCount?: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractLineDto)
  lines!: ContractLineDto[];
}
class AllocationDto {
  @IsUUID() lotId!: string;
  @IsUUID() locationId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
}
class ShipmentLineDto {
  @IsUUID() itemId!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(?:\.\d{1,6})?$/)
  unitPricePerKg?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations!: AllocationDto[];
}
class ShipmentDto {
  @IsUUID() customerId!: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsIn(["USD", "UZS"]) currency!: "USD" | "UZS";
  @IsIn(["PRODUCT", "WASTE"]) kind!: string;
  @IsString() @Matches(/\S/) @MaxLength(30) vehicleNumber!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineDto)
  lines!: ShipmentLineDto[];
}
class DirectSaleDto {
  @IsString() @Matches(/\S/) @MaxLength(150) customerName!: string;
  @IsUUID() itemId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
  @IsString() @Matches(/^\d{1,12}(?:\.\d{1,6})?$/) unitPricePerKg!: string;
  @IsIn(["USD", "UZS"]) currency!: "USD" | "UZS";
}
class ReasonDto {
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
class AmendDto extends ReasonDto {
  @IsInt() @Min(1) version!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractLineDto)
  lines!: ContractLineDto[];
}
@Controller()
@UseGuards(AccessGuard)
@Allow("factory.write")
export class SalesController {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}
  @Get("customers") customers(@Query() q: PageQuery) {
    return page(this.db.customer, { orderBy: { name: "asc" } }, q, "name");
  }
  @Get("contracts") contracts(@Query() q: PageQuery) {
    return page(
      this.db.contract,
      {
        include: {
          customer: true,
          lines: {
            include: {
              item: true,
              shipmentLines: {
                include: { shipment: { include: { document: true } } },
              },
            },
          },
          shipments: { include: { document: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      q,
      "number",
    );
  }
  @Get("shipments") shipments(@Query() q: PageQuery) {
    return page(
      this.db.shipment,
      {
        include: {
          document: true,
          customer: true,
          contract: true,
          lines: { include: { item: true, allocations: true } },
        },
        orderBy: { document: { postedAt: "desc" } },
      },
      q,
      "vehicleNumber",
    );
  }
  @Post("customers") customer(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: CustomerDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "CUSTOMER_CREATE",
      dto,
      async (tx) => {
        const r = await tx.customer.create({
          data: { name: dto.name.trim(), phone: dto.phone },
        });
        return { id: r.id, name: r.name };
      },
    );
  }
  @Post("contracts") contract(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: ContractDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "CONTRACT_CREATE",
      dto,
      async (tx) => {
        ensure(
          (
            await tx.customer.findUniqueOrThrow({
              where: { id: dto.customerId },
            })
          ).isActive,
          "Клиент отключён",
        );
        ensure(
          new Set(dto.lines.map((l) => l.itemId)).size === dto.lines.length,
          "Объедините одинаковую продукцию в одну строку",
        );
        for (const l of dto.lines) {
          const item = await tx.item.findUniqueOrThrow({
            where: { id: l.itemId },
          });
          ensure(
            item.kind === "PRODUCT" && item.isActive,
            "Выберите действующую продукцию",
          );
          kg(l.agreedQuantityKg);
          ensure(
            decimal(l.unitPricePerKg).gt(0),
            "Цена должна быть положительной",
          );
        }
        const r = await tx.contract.create({
          data: {
            number: dto.number.trim(),
            customerId: dto.customerId,
            currency: dto.currency,
            plannedTruckCount: dto.plannedTruckCount,
            lines: { create: dto.lines },
          },
        });
        return { id: r.id, number: r.number, currency: r.currency };
      },
    );
  }
  @Post("sales") directSale(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: DirectSaleDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "SHIPMENT",
      dto,
      async (tx) => {
        const quantity = decimal(kg(dto.quantityKg));
        const price = decimal(dto.unitPricePerKg);
        ensure(price.gt(0), "Цена должна быть положительной");
        const item = await tx.item.findUniqueOrThrow({
          where: { id: dto.itemId },
        });
        ensure(
          item.kind === "PRODUCT" && item.isActive,
          "Выберите готовую продукцию",
        );
        const candidates = await tx.inventoryBalance.findMany({
          where: {
            lot: {
              itemId: item.id,
              OR: [{ stockKind: "PRODUCT" }, { stockKind: null }],
              isCarryover: false,
            },
            location: { kind: "STORAGE", name: "Склад для продажи" },
            onHandKg: { gt: 0 },
          },
          orderBy: [
            { lot: { createdAt: "asc" } },
            { lotId: "asc" },
            { locationId: "asc" },
          ],
        });
        await balancesLock(tx, candidates);
        const allocations = [];
        let remaining = quantity;
        for (const candidate of candidates) {
          const balance = await tx.inventoryBalance.findUniqueOrThrow({
            where: {
              lotId_locationId: {
                lotId: candidate.lotId,
                locationId: candidate.locationId,
              },
            },
          });
          const take = decimal(balance.onHandKg).minus(balance.reservedKg);
          const amount = take.lt(remaining) ? take : remaining;
          if (amount.lte(0)) continue;
          allocations.push({
            lotId: balance.lotId,
            locationId: balance.locationId,
            quantityKg: amount,
          });
          remaining = remaining.minus(amount);
          if (remaining.isZero()) break;
        }
        ensure(
          remaining.isZero(),
          "Недостаточно готовой продукции на складе для продажи",
        );
        const name = dto.customerName.trim();
        await lock(tx, `customer-name:${name.toLowerCase()}`);
        let customer = await tx.customer.findFirst({
          where: {
            name: { equals: name, mode: "insensitive" },
            isActive: true,
          },
          orderBy: { id: "asc" },
        });
        if (!customer) customer = await tx.customer.create({ data: { name } });
        await tx.businessDocument.create({
          data: { id, commandId: id, type: "SHIPMENT" },
        });
        await tx.shipment.create({
          data: {
            id,
            documentId: id,
            customerId: customer.id,
            currency: dto.currency,
            kind: "PRODUCT",
          },
        });
        const total = quantity.times(price);
        const line = await tx.shipmentLine.create({
          data: {
            shipmentId: id,
            itemId: item.id,
            quantityKg: quantity,
            unitPricePerKg: price,
            amount: total,
          },
        });
        for (const allocation of allocations) {
          await movement(
            tx,
            id,
            allocation.lotId,
            allocation.locationId,
            allocation.quantityKg.negated(),
            "SHIPMENT",
          );
          await tx.shipmentAllocation.create({
            data: { shipmentLineId: line.id, ...allocation },
          });
        }
        return { id, amount: total.toString(), currency: dto.currency };
      },
    );
  }
  @Post("shipments") shipment(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: ShipmentDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "SHIPMENT",
      dto,
      async (tx) => {
        ensure(
          (
            await tx.customer.findUniqueOrThrow({
              where: { id: dto.customerId },
            })
          ).isActive,
          "Клиент отключён",
        );
        ensure(
          dto.kind !== "PRODUCT" || dto.contractId,
          "Для продукции выберите договор",
        );
        if (dto.contractId) await lock(tx, `contract:${dto.contractId}`);
        const contract = dto.contractId
          ? await tx.contract.findUniqueOrThrow({
              where: { id: dto.contractId },
              include: { lines: true },
            })
          : null;
        if (contract)
          ensure(
            contract.status === "ACTIVE" &&
              contract.customerId === dto.customerId &&
              contract.currency === dto.currency &&
              dto.kind === "PRODUCT",
            "Проверьте клиента, валюту и статус договора",
          );
        ensure(
          new Set(dto.lines.map((l) => l.itemId)).size === dto.lines.length,
          "Объедините одинаковые позиции",
        );
        const allocs = dto.lines.flatMap((l) => l.allocations);
        ensure(
          new Set(allocs.map((a) => `${a.lotId}:${a.locationId}`)).size ===
            allocs.length,
          "Партия в зоне указана несколько раз",
        );
        await balancesLock(tx, allocs);
        const vehicleNumber = dto.vehicleNumber.trim().toUpperCase();
        const vehicle = await tx.vehicle.upsert({
          where: { number: vehicleNumber },
          create: { number: vehicleNumber },
          update: {},
        });
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: dto.kind === "WASTE" ? "WASTE_SALE" : "SHIPMENT",
          },
        });
        await tx.shipment.create({
          data: {
            id,
            documentId: id,
            customerId: dto.customerId,
            contractId: dto.contractId,
            vehicleId: vehicle.id,
            vehicleNumber,
            currency: dto.currency,
            kind: dto.kind,
          },
        });
        let total = decimal("0");
        for (const line of dto.lines) {
          const item = await tx.item.findUniqueOrThrow({
            where: { id: line.itemId },
          });
          ensure(
            item.kind === dto.kind && item.isActive,
            "Неверная номенклатура",
          );
          const quantity = line.allocations.reduce(
            (a, r) => a.plus(kg(r.quantityKg)),
            decimal("0"),
          );
          const cl = contract?.lines.find((l) => l.itemId === line.itemId);
          let price = decimal(line.unitPricePerKg ?? "0");
          if (contract) {
            ensure(cl, "Позиция отсутствует в договоре");
            price = cl.unitPricePerKg;
            const shipped = await tx.shipmentLine.aggregate({
              where: {
                contractLineId: cl.id,
                shipment: { document: { status: "POSTED" } },
              },
              _sum: { quantityKg: true },
            });
            ensure(
              decimal(shipped._sum.quantityKg ?? "0")
                .plus(quantity)
                .lte(cl.agreedQuantityKg),
              "Превышен остаток договора",
            );
          }
          ensure(price.gt(0), "Укажите положительную цену");
          const amount = quantity.times(price);
          total = total.plus(amount);
          const sl = await tx.shipmentLine.create({
            data: {
              shipmentId: id,
              contractLineId: cl?.id,
              itemId: item.id,
              quantityKg: quantity,
              unitPricePerKg: price,
              amount,
            },
          });
          for (const a of line.allocations) {
            const lot = await tx.stockLot.findUniqueOrThrow({
              where: { id: a.lotId },
            });
            ensure(!lot.isCarryover, "Металл в котле ещё не выпущен на склад");
            ensure(lot.itemId === item.id, "Партия не соответствует позиции");
            const loc = await tx.stockLocation.findUniqueOrThrow({
              where: { id: a.locationId },
            });
            ensure(
              loc.kind === "STORAGE",
              "Отгрузка разрешена только со склада",
            );
            await movement(
              tx,
              id,
              a.lotId,
              a.locationId,
              decimal(a.quantityKg).negated(),
              dto.kind === "WASTE" ? "WASTE_SALE" : "SHIPMENT",
            );
            await tx.shipmentAllocation.create({
              data: { shipmentLineId: sl.id, ...a },
            });
          }
        }
        return {
          id,
          currency: dto.currency,
          amount: total.toString(),
          vehicleNumber,
        };
      },
    );
  }
  @Post("shipments/:id/depart") depart(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "SHIPMENT_DEPART",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `document:${id}`);
        const s = await tx.shipment.findUniqueOrThrow({
          where: { id },
          include: { document: true },
        });
        ensure(
          s.document.status === "POSTED" && !s.departedAt,
          "Машина уже выехала или отгрузка отменена",
        );
        const departedAt = new Date();
        await tx.shipment.update({ where: { id }, data: { departedAt } });
        return { id, departedAt: departedAt.toISOString(), reason: dto.reason };
      },
    );
  }
  @Post("contracts/:id/amend") amend(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AmendDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "CONTRACT_AMEND",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `contract:${id}`);
        const c = await tx.contract.findUniqueOrThrow({
          where: { id },
          include: { lines: true },
        });
        ensure(
          c.version === dto.version && c.status === "ACTIVE",
          "Договор изменён или закрыт",
        );
        ensure(
          new Set(dto.lines.map((l) => l.itemId)).size === dto.lines.length,
          "Повтор позиции",
        );
        const before = c.lines.map((l) => ({
          itemId: l.itemId,
          agreedQuantityKg: l.agreedQuantityKg.toString(),
          unitPricePerKg: l.unitPricePerKg.toString(),
        }));
        for (const l of dto.lines) {
          const cl = c.lines.find((x) => x.itemId === l.itemId);
          ensure(cl, "Изменение допускается только для существующих позиций");
          const shipped = await tx.shipmentLine.aggregate({
            where: {
              contractLineId: cl.id,
              shipment: { document: { status: "POSTED" } },
            },
            _sum: { quantityKg: true },
          });
          ensure(
            decimal(kg(l.agreedQuantityKg)).gte(shipped._sum.quantityKg ?? 0),
            "Объём не может быть меньше уже отгруженного",
          );
          ensure(
            decimal(l.unitPricePerKg).gt(0),
            "Цена должна быть положительной",
          );
          await tx.contractLine.update({
            where: { id: cl.id },
            data: {
              agreedQuantityKg: l.agreedQuantityKg,
              unitPricePerKg: l.unitPricePerKg,
            },
          });
        }
        await tx.contract.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return {
          id,
          before,
          after: dto.lines.map((l) => ({ ...l })),
          reason: dto.reason,
        };
      },
    );
  }
  @Post("contracts/:id/close") close(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "CONTRACT_CLOSE",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `contract:${id}`);
        const c = await tx.contract.findUniqueOrThrow({ where: { id } });
        ensure(c.status === "ACTIVE", "Договор уже закрыт");
        await tx.contract.update({
          where: { id },
          data: { status: "CLOSED", version: { increment: 1 } },
        });
        return { id, status: "CLOSED", reason: dto.reason };
      },
    );
  }
}
