import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  OnModuleInit,
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
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { Database } from "./db";
import { OperationsService } from "./operations";
import { normalizeWebsiteDomain } from "./lead-verification";
import { CodeDiscoveredLead, discoverLeadSites } from "./lead-discovery";

const defaultLeadConfig = {
  productNames: ["Латунные прутки", "Медные прутки"],
  countries: ["Узбекистан", "Казахстан", "Таджикистан", "Кыргызстан"],
  minimumOrderKg: 1000,
  buyerTypes: [
    "Промышленные заводы",
    "Производственные цеха",
    "Предприятия, использующие латунные или медные прутки в производстве",
  ],
  outreachLanguages: ["Определять по языку сайта компании"],
  intermediaryMode: "MANUFACTURERS_ONLY",
} as const;

const leadStatuses = [
  "NEW",
  "VERIFIED",
  "CONTACTED",
  "RESPONDED",
  "QUOTE_REQUESTED",
  "NEGOTIATION",
  "CUSTOMER",
  "REJECTED",
] as const;

const MIN_LEAD_SCORE = 70;

class LeadAgentConfigDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID("4", { each: true }) productIds!: string[];
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) productNames!: string[];
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

class LeadNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) note!: string;
  @IsOptional() @IsISO8601() nextContactAt?: string;
}

class StartLeadSearchDto {
  @IsInt() @Min(1) @Max(50) limit!: number;
}

const clean = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

type DiscoveredLead = {
  companyName: string;
  website: string;
  country: string;
  city: string;
  industry: string;
  companySize: string;
  estimatedOrderKg: number;
  fitReasons: string[];
  riskFlags: string[];
  score: number;
  scoreExplanation: string;
  contactEmail: string;
  contactPhone: string;
  contactName: string;
  contactRole: string;
  contactTelegram: string;
  contactWhatsapp: string;
  outreachLanguage: string;
  outreachText: string;
  evidence: Array<{ url: string; title: string; excerpt: string }>;
};

type QualifiedLead = Omit<DiscoveredLead,
  "companyName" | "contactEmail" | "contactPhone" | "contactTelegram" | "contactWhatsapp" | "evidence"
>;

export const parseLeadResponsePayload = (payload: any): DiscoveredLead[] => {
  const outputText = payload?.output_text ?? payload?.output
    ?.flatMap((item: any) => item.content ?? [])
    .find((item: any) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI не вернул результат поиска");
  const parsed = JSON.parse(outputText) as { candidates?: DiscoveredLead[] };
  if (!Array.isArray(parsed.candidates)) throw new Error("OpenAI вернул некорректный список кандидатов");
  return parsed.candidates;
};

const leadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["website", "country", "city", "industry", "companySize", "estimatedOrderKg", "fitReasons", "riskFlags", "score", "scoreExplanation", "contactName", "contactRole", "outreachLanguage", "outreachText"],
        properties: {
          website: { type: "string" },
          country: { type: "string" },
          city: { type: "string" },
          industry: { type: "string" },
          companySize: { type: "string", enum: ["Малое", "Среднее", "Крупное", "Неизвестно"] },
          estimatedOrderKg: { type: "integer", minimum: 0 },
          fitReasons: { type: "array", maxItems: 5, items: { type: "string" } },
          riskFlags: { type: "array", maxItems: 5, items: { type: "string" } },
          score: { type: "integer", minimum: 0, maximum: 100 },
          scoreExplanation: { type: "string" },
          contactName: { type: "string" },
          contactRole: { type: "string" },
          outreachLanguage: { type: "string" },
          outreachText: { type: "string" },
        },
      },
    },
  },
};

async function qualifyLeads(
  config: any,
  leads: CodeDiscoveredLead[],
  outcomeLearnings: string,
  signal: AbortSignal,
): Promise<QualifiedLead[]> {
  const responseSchema = structuredClone(leadSchema);
  responseSchema.properties.candidates.maxItems = leads.length;
  const compactCandidates = leads.map((lead) => ({
    companyName: lead.companyName,
    website: lead.website,
    country: lead.country,
    contacts: {
      email: lead.contactEmail,
      phone: lead.contactPhone,
      telegram: lead.contactTelegram,
      whatsapp: lead.contactWhatsapp,
    },
    officialSiteText: lead.profileText.slice(0, 3500),
  }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      text: { format: { type: "json_schema", name: "mrba_lead_candidates", strict: true, schema: responseSchema } },
      input: `Ты квалифицируешь уже найденные и технически проверенные официальные сайты потенциальных B2B-покупателей MRBA. Интернет не ищи и контакты не придумывай. Верни по одной оценке на каждый переданный website.\n\nПродукция: ${config.productNames.join(", ")}.\nСтраны: ${config.countries.join(", ")}.\nМинимальная партия: ${config.minimumOrderKg} кг.\nЖелаемые покупатели: ${config.buyerTypes.join(", ")}.\nПосредники запрещены: ${config.intermediaryMode === "MANUFACTURERS_ONLY" ? "да" : "нет"}.\n\nОпыт прошлых результатов:\n${outcomeLearnings || "Пока нет накопленных результатов."}\n\nДля каждого сайта: определи реальную деятельность и отрасль; реши, применяет ли предприятие латунные или медные прутки; исключи посредников, каталоги и магазины; консервативно оцени возможную партию; оцени соответствие 0–100; составь персональный черновик обращения на языке сайта. scoreExplanation должен содержать 3–5 конкретных предложений: чем занимается компания, где ей могут понадобиться прутки, почему предполагается указанный объём, насколько надёжен контакт и что ещё нужно уточнить. В fitReasons дай 3–5 отдельных доказательных пунктов, а не общие фразы. contactName/contactRole укажи лишь когда они явно присутствуют в переданном тексте, иначе оставь пустыми. Не добавляй новые компании, сайты или контакты. Не заявляй неподтверждённые факты.\n\nКандидаты (текст уже очищен сервером):\n${JSON.stringify(compactCandidates)}`,
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
  });
  if (!response.ok) throw new Error(`OpenAI: ${response.status} ${await response.text()}`);
  const payload = await response.json() as any;
  return parseLeadResponsePayload(payload) as QualifiedLead[];
}

@Controller("lead-agent")
@UseGuards(AccessGuard)
export class LeadAgentController implements OnModuleInit {
  private runningSearches = new Map<string, AbortController>();
  private readonly logger = new Logger(LeadAgentController.name);

  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}

  async onModuleInit() {
    const recovered = await this.db.leadSearchRun.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        progressStage: "FAILED",
        errorMessage: "Поиск остановлен из-за перезапуска сервера. Запустите его повторно.",
        completedAt: new Date(),
      },
    });
    if (recovered.count) this.logger.warn(`Recovered ${recovered.count} interrupted lead searches`);
  }

  @Get("overview")
  @Allow("factory.write")
  async overview() {
    let config = await this.db.leadAgentConfig.findUnique({ where: { id: "default" } });
    if (!config) config = await this.db.leadAgentConfig.create({ data: { id: "default", productNames: [...defaultLeadConfig.productNames], countries: [...defaultLeadConfig.countries], minimumOrderKg: defaultLeadConfig.minimumOrderKg, buyerTypes: [...defaultLeadConfig.buyerTypes], outreachLanguages: [...defaultLeadConfig.outreachLanguages], intermediaryMode: defaultLeadConfig.intermediaryMode } });
    const [candidates, runs, products] = await Promise.all([
      this.db.leadCandidate.findMany({
        where: { score: { gte: MIN_LEAD_SCORE } },
        orderBy: [{ createdAt: "desc" }, { score: "desc" }],
        take: 100,
        include: { evidence: true, statusEvents: { orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { name: true } } } } },
      }),
      this.db.leadSearchRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      this.db.item.findMany({ where: { kind: "PRODUCT", isActive: true }, orderBy: { name: "asc" } }),
    ]);
    const missing = [
      !config?.productNames.length && !config?.productIds.length && "Продукция",
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
      latestCompletedRunId: runs.find((run) => run.status === "COMPLETED")?.id ?? null,
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
      productNames: clean(dto.productNames),
      countries: clean(dto.countries),
      buyerTypes: clean(dto.buyerTypes),
      outreachLanguages: clean(dto.outreachLanguages),
    };
    return this.ops.command(req.actor.id, id, epoch, "LEAD_AGENT_CONFIG", normalized, async (tx) => {
      const products = await tx.item.count({ where: { id: { in: normalized.productIds }, kind: "PRODUCT", isActive: true } });
      if (products !== normalized.productIds.length) throw new BadRequestException("Выберите действующую готовую продукцию");
      if (!normalized.productNames.length && !normalized.productIds.length) throw new BadRequestException("Укажите продукцию для поиска");
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
    @Body() dto: StartLeadSearchDto,
  ) {
    const config = await this.db.leadAgentConfig.findUnique({ where: { id: "default" } });
    if (!config || (!config.productNames.length && !config.productIds.length) || !config.countries.length || !config.minimumOrderKg || !config.buyerTypes.length || !config.outreachLanguages.length || config.intermediaryMode === "UNDECIDED")
      throw new BadRequestException("Сначала заполните параметры поиска клиентов");
    if (!process.env.OPENAI_API_KEY)
      throw new BadRequestException("OpenAI API ещё не подключён");
    const activeRun = await this.db.leadSearchRun.findFirst({ where: { status: "RUNNING" } });
    if (activeRun) throw new BadRequestException("Предыдущий поиск ещё выполняется");
    const runResult = await this.ops.command(req.actor.id, id, epoch, "LEAD_SEARCH_RUN", { configId: config.id, updatedAt: config.updatedAt.toISOString(), limit: dto.limit }, async (tx) => {
      const run = await tx.leadSearchRun.create({ data: { createdBy: req.actor.id, status: "RUNNING", progressStage: "DISCOVERING", targetCount: dto.limit, startedAt: new Date(), criteria: { ...(config as any), limit: dto.limit } } });
      return { id: run.id };
    }) as { id: string };
    const controller = new AbortController();
    this.runningSearches.set(runResult.id, controller);
    void this.executeRun(runResult.id, config, dto.limit, controller);
    return { id: runResult.id, status: "RUNNING" };
  }

  @Post("runs/:id/cancel")
  @Allow("factory.write")
  async cancelRun(@Param("id", new ParseUUIDPipe()) runId: string) {
    this.runningSearches.get(runId)?.abort();
    const result = await this.db.leadSearchRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { status: "CANCELLED", progressStage: "CANCELLED", completedAt: new Date() },
    });
    if (!result.count) throw new BadRequestException("Поиск уже завершён");
    return { id: runId, status: "CANCELLED" };
  }

  private async executeRun(runId: string, config: any, limit: number, controller: AbortController) {
    try {
      const existing = await this.db.leadCandidate.findMany({
        select: { companyName: true, normalizedWebsite: true, contactEmail: true, contactPhone: true },
        orderBy: { createdAt: "desc" },
      });
      const excludedDomains = new Set(existing.map((item) => item.normalizedWebsite));
      const excludedNames = new Set(existing.map((item) => item.companyName.trim().toLocaleLowerCase("ru")));
      const excludedEmails = new Set(existing.map((item) => item.contactEmail?.trim().toLowerCase()).filter(Boolean));
      const excludedPhones = new Set(existing.map((item) => item.contactPhone?.replace(/\D/g, "")).filter(Boolean));
      const collected = new Map<string, DiscoveredLead>();
      const rejected = new Map<string, DiscoveredLead>();
      const pastOutcomes = await this.db.leadCandidate.findMany({
        where: { status: { in: ["CUSTOMER", "NEGOTIATION", "QUOTE_REQUESTED", "REJECTED"] } },
        select: { companyName: true, industry: true, status: true, scoreExplanation: true, statusEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { note: true } } },
        orderBy: { updatedAt: "desc" },
        take: 30,
      });
      const outcomeLearnings = pastOutcomes.map((item) =>
        `- ${item.status}: ${item.companyName}; отрасль: ${item.industry || "не указана"}; ${item.statusEvents[0]?.note || item.scoreExplanation}`,
      ).join("\n");
      await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "DISCOVERING" } });
      const discovered = await discoverLeadSites(config, limit, excludedDomains, controller.signal);
      this.logger.log(`Run ${runId}: code discovery verified ${discovered.length} new sites`);
      if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
      await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "VALIDATING" } });

      const uniqueDiscovered = discovered.filter((lead) => {
        const normalizedName = lead.companyName.trim().toLocaleLowerCase("ru");
        const email = lead.contactEmail.trim().toLowerCase();
        const phone = lead.contactPhone.replace(/\D/g, "");
        if (excludedNames.has(normalizedName) || (email && excludedEmails.has(email)) || (phone && excludedPhones.has(phone))) return false;
        excludedNames.add(normalizedName);
        if (email) excludedEmails.add(email);
        if (phone) excludedPhones.add(phone);
        return true;
      });
      this.logger.log(`Run ${runId}: ${uniqueDiscovered.length} sites remained after duplicate checks`);

      await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "SCORING" } });
      let assessedCount = 0;
      let bestRejectedScore = 0;
      for (let index = 0; index < uniqueDiscovered.length && collected.size < limit; index += 8) {
        if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
        const sourceBatch = uniqueDiscovered.slice(index, index + 8);
        const qualified = await qualifyLeads(config, sourceBatch, outcomeLearnings, controller.signal);
        assessedCount += qualified.length;
        this.logger.log(`Run ${runId}: OpenAI qualified ${qualified.length} of ${sourceBatch.length} checked sites; scores: ${qualified.map((item) => {
          try { return `${normalizeWebsiteDomain(item.website)}=${item.score}`; } catch { return `invalid-url=${item.score}`; }
        }).join(", ")}`);
        const sourceByDomain = new Map(sourceBatch.map((lead) => [normalizeWebsiteDomain(lead.website), lead]));
        for (const assessment of qualified) {
          let domain: string;
          try { domain = normalizeWebsiteDomain(assessment.website); } catch { continue; }
          const source = sourceByDomain.get(domain);
          if (!source || collected.has(domain) || rejected.has(domain)) continue;
          const merged: DiscoveredLead = {
            ...assessment,
            companyName: source.companyName,
            website: source.website,
            country: source.country,
            contactEmail: source.contactEmail,
            contactPhone: source.contactPhone,
            contactTelegram: source.contactTelegram,
            contactWhatsapp: source.contactWhatsapp,
            evidence: source.evidence,
          };
          if (assessment.estimatedOrderKg < config.minimumOrderKg || assessment.score < MIN_LEAD_SCORE) {
            bestRejectedScore = Math.max(bestRejectedScore, assessment.score);
            rejected.set(domain, merged);
            continue;
          }
          if (!assessment.industry.trim() || !assessment.fitReasons.length || !assessment.outreachText.trim()) continue;
          collected.set(domain, merged);
          if (collected.size >= limit) break;
        }
        await this.db.leadSearchRun.update({ where: { id: runId }, data: { foundCount: collected.size } });
      }
      const leads = [...collected.values()].sort((left, right) => right.score - left.score).slice(0, limit);
      if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
      await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "SAVING" } });
      await this.db.$transaction(async (tx) => {
        for (const lead of [...leads, ...rejected.values()]) {
          if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
          let normalizedWebsite: string;
          try { normalizedWebsite = normalizeWebsiteDomain(lead.website); } catch { continue; }
          const candidate = await tx.leadCandidate.create({ data: { runId, companyName: lead.companyName, normalizedWebsite, website: lead.website, country: lead.country || null, city: lead.city || null, industry: lead.industry || null, companySize: lead.companySize || null, estimatedOrderKg: lead.estimatedOrderKg || null, fitReasons: clean(lead.fitReasons || []), riskFlags: clean(lead.riskFlags || []), score: lead.score, scoreExplanation: lead.scoreExplanation, status: lead.score >= MIN_LEAD_SCORE && lead.estimatedOrderKg >= config.minimumOrderKg ? "NEW" : "REJECTED", contactName: lead.contactName || null, contactRole: lead.contactRole || null, contactEmail: lead.contactEmail || null, contactPhone: lead.contactPhone || null, contactTelegram: lead.contactTelegram || null, contactWhatsapp: lead.contactWhatsapp || null, outreachLanguage: lead.outreachLanguage || null, outreachText: lead.outreachText || null, lastVerifiedAt: new Date() } });
          await tx.leadEvidence.deleteMany({ where: { candidateId: candidate.id } });
          const uniqueEvidence = [...new Map(
            lead.evidence
              .filter((e) => e.url)
              .map((e) => [e.url.trim(), e] as const),
          ).values()];
          if (uniqueEvidence.length) await tx.leadEvidence.createMany({
            data: uniqueEvidence.map((e) => ({ candidateId: candidate.id, url: e.url.trim(), title: e.title || null, excerpt: e.excerpt || null, verifiedAt: new Date() })),
            skipDuplicates: true,
          });
        }
        if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
        await tx.leadSearchRun.update({
          where: { id: runId },
          data: {
            status: "COMPLETED",
            progressStage: "COMPLETED",
            foundCount: leads.length,
            resultMessage: leads.length < limit
              ? discovered.length === 0
                ? `Найдено 0 из ${limit}: в расширенной поисковой выдаче не осталось новых официальных сайтов с подтверждёнными контактами.`
                : `Найдено ${leads.length} из ${limit}: проверено сайтов — ${discovered.length}, оценено — ${assessedCount}, лучший отклонённый рейтинг — ${bestRejectedScore || 0}. Кандидаты ниже ${MIN_LEAD_SCORE} и не соответствующие минимальной партии пропущены.`
              : `Найдено и проверено ${leads.length} из ${limit} кандидатов.`,
            completedAt: new Date(),
          },
        });
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.message === "SEARCH_CANCELLED")) {
        await this.db.leadSearchRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { status: "CANCELLED", progressStage: "CANCELLED", completedAt: new Date() } });
        return;
      }
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Неизвестная ошибка";
      await this.db.leadSearchRun.update({ where: { id: runId }, data: { status: "FAILED", progressStage: "FAILED", errorMessage: message, completedAt: new Date() } });
    } finally {
      this.runningSearches.delete(runId);
    }
  }

  @Post("candidates/:id/note")
  @Allow("factory.write")
  note(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") commandId: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) candidateId: string,
    @Body() dto: LeadNoteDto,
  ) {
    return this.ops.command(req.actor.id, commandId, epoch, "LEAD_NOTE", { candidateId, ...dto }, async (tx) => {
      const current = await tx.leadCandidate.findUniqueOrThrow({ where: { id: candidateId }, select: { status: true, internalNotes: true } });
      const note = dto.note.trim();
      const candidate = await tx.leadCandidate.update({
        where: { id: candidateId },
        data: {
          internalNotes: [current.internalNotes, note].filter(Boolean).join("\n"),
          nextContactAt: dto.nextContactAt ? new Date(dto.nextContactAt) : undefined,
        },
      });
      await tx.leadStatusEvent.create({ data: { candidateId, status: current.status, actorId: req.actor.id, note } });
      return { id: candidate.id, nextContactAt: candidate.nextContactAt };
    });
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
      const candidate = await tx.leadCandidate.update({ where: { id: candidateId }, data: { status: dto.status, lastContactedAt: ["CONTACTED", "RESPONDED", "QUOTE_REQUESTED", "NEGOTIATION"].includes(dto.status) ? new Date() : undefined } });
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
