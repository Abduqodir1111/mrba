import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import * as argon2 from "argon2";
import { Database } from "./db";
import { OperationsService } from "./operations";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { ensure, lock } from "./factory";
import { page, PageQuery } from "./pagination";
class CatalogEdit {
  @IsOptional() @IsIn(["STORAGE", "SALE"]) wasteDisposition?: string;
  @IsInt() @Min(1) version!: number;
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
}
class OwnerDto {
  @IsString() @Matches(/^[a-zA-Z0-9_.-]{3,100}$/) login!: string;
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsString() @MinLength(14) @MaxLength(200) password!: string;
}
class UserEdit {
  @IsInt() @Min(1) version!: number;
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsBoolean() isActive!: boolean;
}
class Reason {
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
@Controller()
@UseGuards(AccessGuard)
@Allow("factory.write")
export class AdminController {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}
  @Get("users") users(@Query() q: PageQuery) {
    return page(
      this.db.user,
      {
        select: {
          id: true,
          name: true,
          login: true,
          isActive: true,
          version: true,
          createdAt: true,
        },
      },
      q,
      "name",
    );
  }
  @Get("sessions") sessions(@Req() req: AuthRequest) {
    return this.db.refreshSession.findMany({
      where: {
        userId: req.actor.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, deviceId: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
  }
  @Post("users") user(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: OwnerDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "OWNER_CREATE",
      dto,
      async (tx) => {
        const role = await tx.role.findUniqueOrThrow({
          where: { code: "OWNER" },
        });
        const r = await tx.user.create({
          data: {
            name: dto.name.trim(),
            login: dto.login.toLowerCase(),
            passwordHash: await argon2.hash(dto.password, {
              type: argon2.argon2id,
            }),
            roles: { create: { roleId: role.id } },
          },
        });
        return { id: r.id, name: r.name, login: r.login, role: "OWNER" };
      },
    );
  }
  @Post("users/:id/edit") editUser(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UserEdit,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "OWNER_EDIT",
      { id, ...dto },
      async (tx) => {
        await lock(tx, "owner-accounts");
        const user = await tx.user.findUniqueOrThrow({ where: { id } });
        ensure(user.version === dto.version, "Профиль уже изменён");
        if (user.isActive && !dto.isActive) {
          ensure(
            (await tx.user.count({
              where: {
                isActive: true,
                roles: { some: { role: { code: "OWNER" } } },
              },
            })) > 1,
            "Нельзя отключить последнего владельца",
          );
          await tx.refreshSession.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        await tx.user.update({
          where: { id },
          data: {
            name: dto.name.trim(),
            isActive: dto.isActive,
            version: { increment: 1 },
          },
        });
        return {
          id,
          before: { name: user.name, isActive: user.isActive },
          after: { name: dto.name, isActive: dto.isActive },
        };
      },
    );
  }
  @Post("sessions/:id/revoke") revoke(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: Reason,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "SESSION_REVOKE",
      { id, ...dto },
      async (tx) => {
        const s = await tx.refreshSession.findUniqueOrThrow({ where: { id } });
        await lock(tx, s.familyId);
        await tx.refreshSession.updateMany({
          where: { familyId: s.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { id, deviceId: s.deviceId, reason: dto.reason };
      },
    );
  }
  @Post("catalog/:kind/:id/edit") edit(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("kind") kind: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CatalogEdit,
  ) {
    ensure(
      ["materials", "items", "suppliers", "customers", "equipment"].includes(
        kind,
      ),
      "Неизвестный справочник",
    );
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "CATALOG_EDIT",
      { kind, id, ...dto },
      async (tx) => {
        await lock(tx, `catalog:${kind}:${id}`);
        const model = (
          {
            materials: tx.material,
            items: tx.item,
            suppliers: tx.supplier,
            customers: tx.customer,
            equipment: tx.equipment,
          } as any
        )[kind];
        const before = await model.findUniqueOrThrow({ where: { id } });
        ensure(before.version === dto.version, "Запись уже изменена");
        const data: any = {
          name: dto.name.trim(),
          isActive: dto.isActive,
          version: { increment: 1 },
        };
        if (["suppliers", "customers"].includes(kind)) {
          data.phone = dto.phone;
          data.notes = dto.notes;
        }
        if (kind === "materials") data.category = dto.category;
        if (dto.wasteDisposition !== undefined) {
          ensure(
            kind === "items" && before.kind === "WASTE",
            "Назначение можно указать только для отходов",
          );
          data.wasteDisposition = dto.wasteDisposition;
        }
        const after = await model.update({ where: { id }, data });
        if (kind === "materials")
          await tx.item.update({
            where: { id },
            data: {
              name: after.name,
              isActive: after.isActive,
              version: { increment: 1 },
            },
          });
        if (kind === "items" && before.kind === "MATERIAL")
          await tx.material.update({
            where: { id },
            data: {
              name: after.name,
              isActive: after.isActive,
              version: { increment: 1 },
            },
          });
        return {
          id,
          before: JSON.parse(JSON.stringify(before)),
          after: JSON.parse(JSON.stringify(after)),
        };
      },
    );
  }
}
