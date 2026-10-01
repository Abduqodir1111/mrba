import { normalizePublicWebsite, normalizeWebsiteDomain, verifyLeadContacts, VerifiedLeadContacts } from "./lead-verification";

type DiscoveryConfig = {
  productNames: string[];
  countries: string[];
  buyerTypes: string[];
};

export type CodeDiscoveredLead = VerifiedLeadContacts & {
  country: string;
};

type DiscoveryDependencies = {
  fetchImpl?: typeof fetch;
  verify?: typeof verifyLeadContacts;
};

const BLOCKED_HOSTS = [
  "duckduckgo.com", "google.com", "bing.com", "yandex.com", "facebook.com", "instagram.com",
  "linkedin.com", "youtube.com", "wikipedia.org", "yellowpages.com", "2gis.com", "all.biz",
];
const DIRECTORY_PATTERN = /(?:каталог|список\s+(?:компаний|предприятий)|предприятия\s+(?:узбекистана|казахстана|таджикистана|кыргызстана)|business\s+directory|company\s+directory|yellow\s+pages|справочник(?:\s+компаний|\s+предприятий)?|официальный\s+представитель|продажа\s+металлопроката|торговая\s+компания|дилер|дистрибьютор)/i;

const decodeHtml = (value: string) => value
  .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");

const unwrapSearchUrl = (value: string) => {
  const decoded = decodeHtml(value);
  const url = new URL(decoded, "https://html.duckduckgo.com");
  const target = url.searchParams.get("uddg");
  return normalizePublicWebsite(target ? decodeURIComponent(target) : url.toString()).toString();
};

const isBlockedHost = (host: string) => BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));

export const parseSearchResultUrls = (html: string) => {
  const urls: string[] = [];
  for (const match of html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["']/gi)) {
    try {
      const url = unwrapSearchUrl(match[1]);
      const host = normalizeWebsiteDomain(url);
      if (!isBlockedHost(host)) urls.push(url);
    } catch { /* ignore malformed and unsupported links */ }
  }
  return [...new Set(urls)];
};

const unwrapBingUrl = (value: string) => {
  const url = new URL(decodeHtml(value));
  if (!url.hostname.endsWith("bing.com")) return normalizePublicWebsite(url.toString()).toString();
  const encoded = url.searchParams.get("u") || "";
  if (!encoded.startsWith("a1")) throw new Error("Unsupported Bing redirect");
  return normalizePublicWebsite(Buffer.from(encoded.slice(2), "base64url").toString("utf8")).toString();
};

export const parseBingResultUrls = (html: string) => {
  const urls: string[] = [];
  for (const block of html.matchAll(/<li class=["']b_algo["'][\s\S]*?<\/li>/gi)) {
    const href = block[0].match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const url = unwrapBingUrl(href);
      const host = normalizeWebsiteDomain(url);
      if (!isBlockedHost(host)) urls.push(url);
    } catch { /* ignore malformed result links */ }
  }
  return [...new Set(urls)];
};

const countryFromLead = (lead: VerifiedLeadContacts, allowedCountries: string[]) => {
  const value = `${lead.website} ${lead.profileText} ${lead.contactPhone}`.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["Узбекистан", /(?:\.uz\b|\+998|uzbekistan|o['’]?zbekiston|узбекистан)/i],
    ["Казахстан", /(?:\.kz\b|\+7|kazakhstan|қазақстан|казахстан)/i],
    ["Таджикистан", /(?:\.tj\b|\+992|tajikistan|тоҷикистон|таджикистан)/i],
    ["Кыргызстан", /(?:\.kg\b|\+996|kyrgyzstan|кыргызстан|киргизия)/i],
  ];
  return rules.find(([country, pattern]) => allowedCountries.includes(country) && pattern.test(value))?.[0] || "";
};

const buildQueries = (config: DiscoveryConfig) => {
  const queries: string[] = [];
  const industries = [
    "завод производство латунных фитингов клапанов контакты",
    "производство деталей из латуни меди контакты",
    "CNC обработка латуни меди завод контакты",
    "электротехнический завод медные контакты комплектующие",
    "машиностроительный завод цветные металлы контакты",
  ];
  for (const industry of industries) {
    for (const country of config.countries) queries.push(`${country} ${industry}`);
  }
  return queries;
};

const discoverWebsiteFallback = async (config: DiscoveryConfig, signal: AbortSignal) => {
  if (!process.env.OPENAI_API_KEY) return [];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: "auto",
      text: {
        format: {
          type: "json_schema",
          name: "mrba_official_websites",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["websites"],
            properties: {
              websites: {
                type: "array",
                maxItems: 30,
                items: { type: "string" },
              },
            },
          },
        },
      },
      input: `Найди официальные сайты производственных предприятий, которым могут быть нужны ${config.productNames.join(", ")} партиями от 1000 кг. Страны: ${config.countries.join(", ")}. Типы: ${config.buyerTypes.join(", ")}. Верни только главные страницы официальных сайтов заводов и производственных цехов. Не возвращай каталоги, магазины, маркетплейсы, трейдеров, социальные сети и посредников. Ничего кроме списка URL не оценивай и контакты не ищи.`,
    }),
  });
  if (!response.ok) return [];
  const payload = await response.json() as any;
  const outputText = payload.output_text ?? payload.output
    ?.flatMap((item: any) => item.content ?? [])
    .find((item: any) => item.type === "output_text")?.text;
  if (!outputText) return [];
  try {
    const parsed = JSON.parse(outputText) as { websites?: string[] };
    return Array.isArray(parsed.websites) ? parsed.websites : [];
  } catch {
    return [];
  }
};

export async function discoverLeadSites(
  config: DiscoveryConfig,
  desiredCount: number,
  excludedDomains: Set<string>,
  signal: AbortSignal,
  deps: DiscoveryDependencies = {},
): Promise<CodeDiscoveredLead[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const verify = deps.verify ?? verifyLeadContacts;
  const candidateUrls: string[] = [];
  const seen = new Set(excludedDomains);

  const discoveryDeadline = AbortSignal.timeout(120_000);
  const discoverySignal = AbortSignal.any([signal, discoveryDeadline]);
  const searchTasks = buildQueries(config).flatMap((query) =>
    [0, 30, 60].map((offset) => ({ query, offset })),
  );
  let searchFailures = 0;
  let successfulSearchResponses = 0;
  const runLimited = async <T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) => {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length && !discoverySignal.aborted) {
        const item = items[cursor++];
        await work(item);
      }
    }));
  };

  await runLimited(searchTasks, 8, async ({ query, offset }) => {
    if (searchFailures >= 8 && successfulSearchResponses === 0) return;
    try {
      const response = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`, {
        signal: AbortSignal.any([discoverySignal, AbortSignal.timeout(8_000)]),
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
          "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
          accept: "text/html",
        },
      });
      if (!response.ok) {
        searchFailures++;
        return;
      }
      successfulSearchResponses++;
      for (const url of parseSearchResultUrls(await response.text())) {
        const domain = normalizeWebsiteDomain(url);
        if (seen.has(domain)) continue;
        seen.add(domain);
        candidateUrls.push(url);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      searchFailures++;
    }
  });

  if (candidateUrls.length === 0 && !signal.aborted) {
    const fallbackUrls = await discoverWebsiteFallback(config, signal).catch(() => []);
    for (const url of fallbackUrls) {
      try {
        const normalized = normalizePublicWebsite(url).href;
        const domain = normalizeWebsiteDomain(normalized);
        if (seen.has(domain)) continue;
        seen.add(domain);
        candidateUrls.push(normalized);
      } catch {
        // Ignore malformed URLs returned by the discovery provider.
      }
    }
  }

  const results: CodeDiscoveredLead[] = [];
  const verifiedTarget = Math.max(desiredCount * 12, 20);
  await runLimited(candidateUrls, 6, async (website) => {
    if (results.length >= verifiedTarget || discoverySignal.aborted) return;
    const lead = await verify({ website }, { signal: discoverySignal }).catch(() => null);
    if (!lead || results.length >= verifiedTarget) return;
    if (DIRECTORY_PATTERN.test(lead.companyName)) return;
    const country = countryFromLead(lead, config.countries);
    if (!country) return;
    results.push({ ...lead, country });
  });
  return results;
}
