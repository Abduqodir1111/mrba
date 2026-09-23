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

const normalizeWebsite = (value: string) => {
  const url = new URL(value);
  return url.hostname.toLowerCase().replace(/^www\./, "");
};

const verifiedTelegramUrl = (value: string) => {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://t.me/${value.replace(/^@/, "")}`);
    if (!["t.me", "telegram.me", "www.t.me", "www.telegram.me"].includes(url.hostname.toLowerCase())) return null;
    const username = url.pathname.split("/").filter(Boolean)[0];
    return username && !["share", "joinchat"].includes(username.toLowerCase()) ? `https://t.me/${username}` : null;
  } catch { return null; }
};

const phoneDigits = (value: string) => value.replace(/\D/g, "");

const verifiedWhatsappUrl = (value: string, contactPhone: string) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["wa.me", "www.wa.me", "api.whatsapp.com", "www.whatsapp.com"].includes(host)) return null;
    const number = host.includes("whatsapp.com") ? url.searchParams.get("phone")?.replace(/\D/g, "") : url.pathname.replace(/\D/g, "");
    const listedNumber = phoneDigits(contactPhone || "");
    if (number && listedNumber && number !== listedNumber) return null;
    return number ? `https://wa.me/${number}` : null;
  } catch { return null; }
};

const leadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["companyName", "website", "country", "city", "industry", "companySize", "estimatedOrderKg", "fitReasons", "riskFlags", "score", "scoreExplanation", "contactName", "contactRole", "contactEmail", "contactPhone", "contactTelegram", "contactWhatsapp", "outreachLanguage", "outreachText", "evidence"],
        properties: {
          companyName: { type: "string" },
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
          contactEmail: { type: "string" },
          contactPhone: { type: "string" },
          contactTelegram: { type: "string" },
          contactWhatsapp: { type: "string" },
          outreachLanguage: { type: "string" },
          outreachText: { type: "string" },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["url", "title", "excerpt"],
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                excerpt: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

async function discoverLeads(
  config: any,
  limit: number,
  excludedCompanies: Array<{ companyName: string; normalizedWebsite: string }>,
  outcomeLearnings: string,
  signal: AbortSignal,
): Promise<DiscoveredLead[]> {
  const responseSchema = structuredClone(leadSchema);
  responseSchema.properties.candidates.maxItems = limit;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "auto",
      text: { format: { type: "json_schema", name: "mrba_lead_candidates", strict: true, schema: responseSchema } },
      input: `Работай как B2B-аналитик металлургической компании MRBA. Найди до ${limit} НОВЫХ реальных потенциальных покупателей.\nПродукция: ${config.productNames.join(", ")}.\nСтраны: ${config.countries.join(", ")}.\nМинимальная партия: ${config.minimumOrderKg} кг.\nТипы покупателей: ${config.buyerTypes.join(", ")}.\n\nОПЫТ ПРЕДЫДУЩЕЙ РАБОТЫ АГЕНТА:\n${outcomeLearnings || "Пока нет накопленных результатов."}\nИспользуй положительные результаты как признаки приоритета, а отклонённые компании и причины — как признаки исключения.\n\nУЖЕ НАЙДЕННЫЕ КОМПАНИИ, КОТОРЫЕ НЕЛЬЗЯ ВОЗВРАЩАТЬ ПОВТОРНО:\n${excludedCompanies.length ? excludedCompanies.map((item) => `- ${item.companyName} (${item.normalizedWebsite})`).join("\n") : "Список пуст"}\n\nДля каждой компании выполни этапы: 1) найди официальный сайт; 2) докажи, что предприятие производит товары, где реально применяются медные или латунные прутки; 3) оцени размер предприятия и вероятный объём заказа; 4) найди сотрудника или отдел закупок, снабжения, коммерческого директора, директора производства либо владельца; 5) проверь актуальность сайта и контактной страницы; 6) найди прямые контакты; 7) выставь итоговый балл; 8) составь персональное обращение на языке сайта.\n\nОценка 0–100: соответствие продукции — 35 баллов, размер и потенциальный объём — 20, прямой ответственный контакт — 20, подтверждённые свежие источники — 15, соответствие стране и минимальной партии — 10. В fitReasons перечисли конкретные доказанные причины соответствия. В riskFlags укажи сомнения: устаревший сайт, только общий контакт, неясный объём и подобное. companySize должен содержать строго одно значение: Малое, Среднее, Крупное или Неизвестно; основание размера вынеси в fitReasons. estimatedOrderKg — консервативная оценка возможной партии, 0 если оценить нельзя.\n\nНе возвращай филиалы ранее найденных компаний, посредников, трейдеров, магазины и каталоги. Каталоги можно использовать только для обнаружения официального сайта. Не придумывай сведения. Сохраняй компанию только при наличии прямого контакта: email, официальный Telegram или WhatsApp. Если найден телефон, ищи этот же номер на официальной странице контактов. contactWhatsapp заполняй только опубликованной ссылкой wa.me/whatsapp.com с тем же номером, что contactPhone. contactTelegram заполняй только официальной ссылкой t.me/telegram.me с сайта компании; Telegram нельзя угадывать по номеру. Неподтверждённый канал оставляй пустым. contactName и contactRole заполняй только при наличии источника, иначе оставляй пустыми. Для всех ключевых утверждений добавь evidence с точным URL и короткой выдержкой. Обращение должно упоминать деятельность компании, подходящую продукцию MRBA и минимальную партию, но не выдумывать цену. Не отправляй сообщения.`,
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
  });
  if (!response.ok) throw new Error(`OpenAI: ${response.status} ${await response.text()}`);
  const payload = await response.json() as any;
  const outputText = payload.output_text ?? payload.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI не вернул результат поиска");
  const parsed = JSON.parse(outputText) as { candidates: DiscoveredLead[] };
  return parsed.candidates.map((lead) => ({
    ...lead,
    contactTelegram: verifiedTelegramUrl(lead.contactTelegram) || "",
    contactWhatsapp: verifiedWhatsappUrl(lead.contactWhatsapp, lead.contactPhone) || "",
  })).filter((lead) => lead.contactEmail || lead.contactTelegram || lead.contactWhatsapp);
}

@Controller("lead-agent")
@UseGuards(AccessGuard)
export class LeadAgentController {
  private runningSearches = new Map<string, AbortController>();

  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}

  @Get("overview")
  @Allow("factory.write")
  async overview() {
    let config = await this.db.leadAgentConfig.findUnique({ where: { id: "default" } });
    if (!config) config = await this.db.leadAgentConfig.create({ data: { id: "default", productNames: [...defaultLeadConfig.productNames], countries: [...defaultLeadConfig.countries], minimumOrderKg: defaultLeadConfig.minimumOrderKg, buyerTypes: [...defaultLeadConfig.buyerTypes], outreachLanguages: [...defaultLeadConfig.outreachLanguages], intermediaryMode: defaultLeadConfig.intermediaryMode } });
    const [candidates, runs, products] = await Promise.all([
      this.db.leadCandidate.findMany({
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
        select: { companyName: true, normalizedWebsite: true },
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      const excludedDomains = new Set(existing.map((item) => item.normalizedWebsite));
      const excludedNames = new Set(existing.map((item) => item.companyName.trim().toLocaleLowerCase("ru")));
      const collected = new Map<string, DiscoveredLead>();
      const exclusions = [...existing];
      const pastOutcomes = await this.db.leadCandidate.findMany({
        where: { status: { in: ["CUSTOMER", "NEGOTIATION", "QUOTE_REQUESTED", "REJECTED"] } },
        select: { companyName: true, industry: true, status: true, scoreExplanation: true, statusEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { note: true } } },
        orderBy: { updatedAt: "desc" },
        take: 30,
      });
      const outcomeLearnings = pastOutcomes.map((item) =>
        `- ${item.status}: ${item.companyName}; отрасль: ${item.industry || "не указана"}; ${item.statusEvents[0]?.note || item.scoreExplanation}`,
      ).join("\n");
      for (let attempt = 0; attempt < 3 && collected.size < limit; attempt++) {
        await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: attempt === 0 ? "DISCOVERING" : "EXPANDING" } });
        const batch = await discoverLeads(config, limit - collected.size, exclusions, outcomeLearnings, controller.signal);
        if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
        await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "VALIDATING" } });
        for (const lead of batch) {
          let domain: string;
          try { domain = normalizeWebsite(lead.website); } catch { continue; }
          const normalizedName = lead.companyName.trim().toLocaleLowerCase("ru");
          if (excludedDomains.has(domain) || excludedNames.has(normalizedName) || collected.has(domain)) continue;
          collected.set(domain, lead);
          excludedDomains.add(domain);
          excludedNames.add(normalizedName);
          exclusions.push({ companyName: lead.companyName, normalizedWebsite: domain });
        }
        await this.db.leadSearchRun.update({ where: { id: runId }, data: { foundCount: collected.size } });
      }
      const leads = [...collected.values()];
      if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
      await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "SCORING", foundCount: leads.length } });
      await this.db.leadSearchRun.update({ where: { id: runId }, data: { progressStage: "SAVING" } });
      await this.db.$transaction(async (tx) => {
        for (const lead of leads) {
          if (controller.signal.aborted) throw new Error("SEARCH_CANCELLED");
          let normalizedWebsite: string;
          try { normalizedWebsite = normalizeWebsite(lead.website); } catch { continue; }
          const candidate = await tx.leadCandidate.create({ data: { runId, companyName: lead.companyName, normalizedWebsite, website: lead.website, country: lead.country || null, city: lead.city || null, industry: lead.industry || null, companySize: lead.companySize || null, estimatedOrderKg: lead.estimatedOrderKg || null, fitReasons: clean(lead.fitReasons || []), riskFlags: clean(lead.riskFlags || []), score: lead.score, scoreExplanation: lead.scoreExplanation, contactName: lead.contactName || null, contactRole: lead.contactRole || null, contactEmail: lead.contactEmail || null, contactPhone: lead.contactPhone || null, contactTelegram: lead.contactTelegram || null, contactWhatsapp: lead.contactWhatsapp || null, outreachLanguage: lead.outreachLanguage || null, outreachText: lead.outreachText || null, lastVerifiedAt: new Date() } });
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
        await tx.leadSearchRun.update({ where: { id: runId }, data: { status: "COMPLETED", progressStage: "COMPLETED", foundCount: leads.length, completedAt: new Date() } });
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
