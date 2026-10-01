import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGES = 6;
const CONTACT_LINK = /(contact|contacts|kontakt|kontakty|aloqa|bog['’]?lanish|контакт|связ)/i;
const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export type LeadContactInput = {
  website: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTelegram?: string;
  contactWhatsapp?: string;
  evidence?: Array<{ url: string; title: string; excerpt: string }>;
};

export type VerifiedLeadContacts = {
  website: string;
  contactEmail: string;
  contactPhone: string;
  contactTelegram: string;
  contactWhatsapp: string;
  verifiedEvidenceUrls: Set<string>;
  checkedPages: number;
  companyName: string;
  profileText: string;
  evidence: Array<{ url: string; title: string; excerpt: string }>;
};

type VerificationDependencies = {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  signal?: AbortSignal;
};

const normalizedHost = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");

export const normalizePublicWebsite = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Разрешены только HTTP/HTTPS сайты");
  if (!url.hostname || url.username || url.password) throw new Error("Некорректный адрес сайта");
  url.hash = "";
  return url;
};

export const normalizeWebsiteDomain = (value: string) => normalizedHost(normalizePublicWebsite(value).hostname);

const isPrivateAddress = (address: string) => {
  if (!isIP(address)) return true;
  if (address === "::1" || address === "0.0.0.0") return true;
  const lower = address.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
};

const defaultResolveHost = async (hostname: string) => (await lookup(hostname, { all: true })).map((item) => item.address);

const assertPublicHost = async (url: URL, resolveHost: (hostname: string) => Promise<string[]>) => {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("Локальный адрес запрещён");
  const addresses = await resolveHost(hostname);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("Непубличный адрес сайта");
};

const sameOrganizationDomain = (candidate: URL, official: URL) => {
  const host = normalizedHost(candidate.hostname);
  const root = normalizedHost(official.hostname);
  return host === root || host.endsWith(`.${root}`) || root.endsWith(`.${host}`);
};

const compactText = (value: string) => value
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

const decodeHtml = (value: string) => value
  .replace(/&quot;|&#34;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&amp;/gi, "&");

const firstMatch = (html: string, pattern: RegExp) => compactText(decodeHtml(html.match(pattern)?.[1] || ""));

const GENERIC_TITLE = /^(?:контакты?|contact(?:s)?|главная(?: страница)?|home(?: page)?|bosh sahifa|официальный сайт|корпоративное управление|о компании|about us)$/i;
const COMPANY_MARKERS = /(?:завод|фабрик|комбинат|company|group|holding|корпорац|предприят|производ|акционер|ооо|ао|mchj|llc|ltd|inc)/i;

export const companyNameFromPage = (html: string, hostname: string) => {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const heading = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const siteName = firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const candidates = [siteName, ...title.split(/\s+(?:[-—–|│])\s+/), heading]
    .map((value, index) => ({ value: value.trim(), siteName: index === 0 }))
    .filter(({ value }) => value.length >= 2 && !GENERIC_TITLE.test(value));
  const ranked = candidates.sort((left, right) => {
    const score = ({ value, siteName }: typeof left) => (siteName ? 2000 : 0) + (COMPANY_MARKERS.test(value) ? 1000 : 0) + Math.min(value.length, 150);
    return score(right) - score(left);
  });
  return (ranked[0]?.value || normalizedHost(hostname).split(".")[0]).slice(0, 200);
};

const extractEmails = (value: string) => [...new Set(
  [...value.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi)]
    .map((match) => match[0].replace(/[.,;:)]+$/, ""))
    .filter((email) => EMAIL.test(email)),
)];

const extractPhones = (value: string) => [...new Set(
  [...value.matchAll(/(?:\+|00)?\d[\d\s().-]{7,}\d/g)]
    .map((match) => match[0].trim())
    .filter((phone) => digits(phone).length >= 9 && digits(phone).length <= 15),
)];

const extractChannelLinks = (html: string, baseUrl: URL) => {
  const telegram: string[] = [];
  const whatsapp: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const raw = decodeHtml(match[1]);
      const url = new URL(raw, baseUrl).toString();
      const telegramLink = telegramUrl(url);
      if (telegramLink) telegram.push(telegramLink);
      if (/https?:\/\/(?:www\.)?(?:wa\.me|api\.whatsapp\.com|whatsapp\.com)\//i.test(url)) whatsapp.push(url);
    } catch { /* ignore malformed links */ }
  }
  return { telegram: [...new Set(telegram)], whatsapp: [...new Set(whatsapp)] };
};

const normalizeComparable = (value: string) => value.toLowerCase().replace(/&amp;/g, "&");
const digits = (value: string) => value.replace(/\D/g, "");

const telegramUrl = (value?: string) => {
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("http") ? value : `https://t.me/${value.replace(/^@/, "")}`);
    if (!["t.me", "telegram.me", "www.t.me", "www.telegram.me"].includes(url.hostname.toLowerCase())) return "";
    const username = url.pathname.split("/").filter(Boolean)[0];
    return username && !["share", "joinchat"].includes(username.toLowerCase()) ? `https://t.me/${username}` : "";
  } catch { return ""; }
};

const whatsappUrl = (value?: string, phone?: string) => {
  if (!value || !phone) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["wa.me", "www.wa.me", "api.whatsapp.com", "www.whatsapp.com"].includes(host)) return "";
    const number = host.includes("whatsapp.com") ? url.searchParams.get("phone")?.replace(/\D/g, "") : digits(url.pathname);
    const listed = digits(phone);
    return number && listed && number === listed ? `https://wa.me/${number}` : "";
  } catch { return ""; }
};

const fetchPage = async (
  initialUrl: URL,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
  signal?: AbortSignal,
) => {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 4; redirects++) {
    await assertPublicHost(url, resolveHost);
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      headers: { "user-agent": "MRBA-LeadVerifier/1.0", accept: "text/html,application/xhtml+xml" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Перенаправление без адреса");
      const next = normalizePublicWebsite(new URL(location, url).toString());
      if (!sameOrganizationDomain(next, initialUrl)) throw new Error("Перенаправление на другой домен");
      url = next;
      continue;
    }
    if (!response.ok) throw new Error(`Сайт ответил ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("Источник не является веб-страницей");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_PAGE_BYTES) throw new Error("Страница слишком большая");
    const html = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return { url, html, text: compactText(html) };
  }
  throw new Error("Слишком много перенаправлений");
};

const extractOfficialLinks = (html: string, baseUrl: URL, officialUrl: URL) => {
  const links: URL[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = normalizePublicWebsite(new URL(match[1], baseUrl).toString());
      if (sameOrganizationDomain(url, officialUrl) && CONTACT_LINK.test(`${url.pathname} ${compactText(match[2])}`)) links.push(url);
    } catch { /* ignore malformed links */ }
  }
  return links;
};

export async function verifyLeadContacts(input: LeadContactInput, deps: VerificationDependencies = {}): Promise<VerifiedLeadContacts | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;
  let official: URL;
  try { official = normalizePublicWebsite(input.website); } catch { return null; }
  const homepage = new URL("/", official);

  const queue: URL[] = [homepage];
  if (official.toString() !== homepage.toString()) queue.push(official);
  for (const evidence of input.evidence ?? []) {
    try {
      const url = normalizePublicWebsite(evidence.url);
      if (sameOrganizationDomain(url, official)) queue.push(url);
    } catch { /* ignore unsafe evidence */ }
  }

  const pages: Array<{ url: URL; html: string; text: string }> = [];
  const seen = new Set<string>();
  while (queue.length && pages.length < MAX_PAGES) {
    const requested = queue.shift()!;
    const key = requested.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const page = await fetchPage(requested, fetchImpl, resolveHost, deps.signal);
      pages.push(page);
      if (pages.length === 1) queue.push(...extractOfficialLinks(page.html, page.url, official));
    } catch {
      if (!pages.length && requested === homepage) {
        if (official.toString() === homepage.toString()) return null;
      }
    }
  }
  if (!pages.length) return null;

  const haystack = normalizeComparable(pages.map((page) => `${page.html} ${page.text}`).join(" "));
  const extractedEmails = extractEmails(pages.map((page) => page.html).join(" "));
  const email = input.contactEmail?.trim() || extractedEmails[0] || "";
  const verifiedEmail = EMAIL.test(email) && haystack.includes(email.toLowerCase()) ? email : "";
  const extractedPhones = extractPhones(pages.map((page) => page.text).join(" "));
  const phone = input.contactPhone?.trim() || extractedPhones[0] || "";
  const phoneNumber = digits(phone);
  const verifiedPhone = phoneNumber.length >= 7 && extractedPhones.some((value) => digits(value) === phoneNumber) ? phone : "";
  const channels = pages.map((page) => extractChannelLinks(page.html, page.url));
  const telegram = telegramUrl(input.contactTelegram) || channels.flatMap((item) => item.telegram)[0] || "";
  const verifiedTelegram = telegram && haystack.includes(normalizeComparable(telegram).replace("https://", "")) ? telegram : "";
  const whatsappCandidates = [input.contactWhatsapp || "", ...channels.flatMap((item) => item.whatsapp)];
  const whatsapp = whatsappCandidates.map((value) => whatsappUrl(value, verifiedPhone)).find(Boolean) || "";
  const whatsappNumber = digits(whatsapp);
  const verifiedWhatsapp = whatsapp && (haystack.includes("wa.me") || haystack.includes("whatsapp.com")) && digits(haystack).includes(whatsappNumber) ? whatsapp : "";
  if (!verifiedEmail && !verifiedTelegram && !verifiedWhatsapp) return null;

  const home = pages[0];
  const companyName = companyNameFromPage(home.html, official.hostname);
  const profileText = pages.map((page) => page.text).join(" ").slice(0, 12_000);
  const evidence = pages.map((page) => ({
    url: page.url.toString(),
    title: firstMatch(page.html, /<title[^>]*>([\s\S]*?)<\/title>/i) || "Официальный сайт компании",
    excerpt: page.text.slice(0, 500),
  }));

  return {
    website: new URL("/", pages[0].url).toString(),
    contactEmail: verifiedEmail,
    contactPhone: verifiedPhone,
    contactTelegram: verifiedTelegram,
    contactWhatsapp: verifiedWhatsapp,
    verifiedEvidenceUrls: new Set(pages.map((page) => page.url.toString())),
    checkedPages: pages.length,
    companyName,
    profileText,
    evidence,
  };
}
