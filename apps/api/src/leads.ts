import {
  BadRequestException,
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
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { Database } from "./db";
import { OperationsService } from "./operations";

const leadStatuses = [
  "NEW",
  "VERIFIED",
  "CONTACTED",
  "NEGOTIATION",
  "CUSTOMER",
  "REJECTED",
] as const;

class LeadAgentConfigDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID("4", { each: true }) productIds!: string[];
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) countries!: string[];
  @IsOptional() @IsInt() @Min(1) @Max(1000000000) minimumOrderKg?: number;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) buyerTypes!: string[];
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) outreachLanguages!: string[];
  @IsIn(["UNDECIDED", "MANUFACTURERS_ONLY", "INCLUDE_INTERMEDIARIES"])
  intermediaryMode!: string;
}

class LeadStatusDto {
  @IsIn(leadStatuses) status!: (typeof leadStatuses)[number];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

const clean = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

@Controller("lead-agent")
@UseGuards(AccessGuard)
export class LeadAgentController {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}

  @Get("overview")
  @Allow("factory.write")
  async overview() {
    const [config, candidates, runs, products] = await Promise.all([
      this.db.leadAgentConfig.findUnique({ where: { id: "default" } }),
      this.db.leadCandidate.findMany({
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 100,
        include: { evidence: true, statusEvents: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      this.db.leadSearchRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      this.db.item.findMany({ where: { kind: "PRODUCT", isActive: true }, orderBy: { name: "asc" } }),
    ]);
    const missing = [
      !config?.productIds.length && "Продукция",
      !config?.countries.length && "Страны поиска",
      !config?.minimumOrderKg && "Минимальная партия",
      !config?.buyerTypes.length && "Тип покупателя",
      !config?.outreachLanguages.length && "Языки обращения",
      (!config || config.intermediaryMode === "UNDECIDED") && "Посредники или производители",
    ].filter(Boolean);
    return {
      config,
      products,
      candidates,
      runs,
      readiness: {
        parametersReady: missing.length === 0,
        providerReady: Boolean(process.env.OPENAI_API_KEY),
        missing,
      },
    };
  }

  @Post("config")
  @Allow("factory.write")
  saveConfig(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: LeadAgentConfigDto,
  ) {
    const normalized = {
      ...dto,
      countries: clean(dto.countries),
      buyerTypes: clean(dto.buyerTypes),
      outreachLanguages: clean(dto.outreachLanguages),
    };
    return this.ops.command(req.actor.id, id, epoch, "LEAD_AGENT_CONFIG", normalized, async (tx) => {
      const products = await tx.item.count({ where: { id: { in: normalized.productIds }, kind: "PRODUCT", isActive: true } });
      if (products !== normalized.productIds.length) throw new BadRequestException("Выберите действующую готовую продукцию");
      const row = await tx.leadAgentConfig.upsert({
        where: { id: "default" },
        create: { id: "default", ...normalized },
        update: normalized,
      });
      return { id: row.id, updatedAt: row.updatedAt.toISOString() };
    });
  }

  @Post("runs")
  @Allow("factory.write")
  async startRun(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
  ) {
    const config = await this.db.leadAgentConfig.findUnique({ where: { id: "default" } });
    if (!config || !config.productIds.length || !config.countries.length || !config.minimumOrderKg || !config.buyerTypes.length || !config.outreachLanguages.length || config.intermediaryMode === "UNDECIDED")
      throw new BadRequestException("Сначала заполните параметры поиска клиентов");
    if (!process.env.OPENAI_API_KEY)
      throw new BadRequestException("OpenAI API ещё не подключён");
    throw new BadRequestException("Исполнитель интернет-поиска будет подключён после передачи API-ключа");
  }

  @Post("candidates/:id/status")
  @Allow("factory.write")
  updateStatus(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") commandId: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) candidateId: string,
    @Body() dto: LeadStatusDto,
  ) {
    return this.ops.command(req.actor.id, commandId, epoch, "LEAD_STATUS_CHANGE", { candidateId, ...dto }, async (tx) => {
      const candidate = await tx.leadCandidate.update({ where: { id: candidateId }, data: { status: dto.status } });
      await tx.leadStatusEvent.create({ data: { candidateId, status: dto.status, actorId: req.actor.id, note: dto.note?.trim() || null } });
      return { id: candidate.id, status: candidate.status };
    });
  }

  @Post("candidates/:id/promote")
  @Allow("factory.write")
  promote(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") commandId: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) candidateId: string,
  ) {
    return this.ops.command(req.actor.id, commandId, epoch, "LEAD_PROMOTE", { candidateId }, async (tx) => {
      const candidate = await tx.leadCandidate.findUniqueOrThrow({ where: { id: candidateId } });
      const customer = await tx.customer.create({ data: { name: candidate.companyName, phone: candidate.contactPhone, notes: `Источник: ${candidate.website}` } });
      await tx.leadCandidate.update({ where: { id: candidateId }, data: { status: "CUSTOMER" } });
      await tx.leadStatusEvent.create({ data: { candidateId, status: "CUSTOMER", actorId: req.actor.id, note: "Добавлен в справочник клиентов" } });
      return { id: customer.id, candidateId };
    });
  }
}
