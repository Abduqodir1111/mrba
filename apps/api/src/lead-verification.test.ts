import assert from "node:assert/strict";
import test from "node:test";
import { companyNameFromPage, normalizePublicWebsite, normalizeWebsiteDomain, verifyLeadContacts } from "./lead-verification";
import { discoverLeadSites, parseBingResultUrls, parseSearchResultUrls } from "./lead-discovery";
import { LeadAgentController, parseLeadResponsePayload } from "./leads";

const publicDns = async () => ["203.0.113.10"];

const htmlResponse = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

test("website normalization accepts public web protocols only", () => {
  assert.equal(normalizeWebsiteDomain("https://www.Example.com/contact#team"), "example.com");
  assert.throws(() => normalizePublicWebsite("javascript:alert(1)"));
  assert.throws(() => normalizePublicWebsite("file:///etc/passwd"));
});

test("company name ignores generic contact-page titles", () => {
  assert.equal(
    companyNameFromPage('<title>Контакты - Акционерное Общество «Ташкентский Механический Завод» │ Ташкент</title><h1>Контакты</h1>', 'tmz.uz'),
    'Акционерное Общество «Ташкентский Механический Завод»',
  );
});

test("company name prefers Open Graph site name over generic home-page labels", () => {
  assert.equal(
    companyNameFromPage('<meta property="og:site_name" content="Uzbek Steel"><title>Bosh sahifa</title><h1>Главная страница</h1>', 'uzbeksteel.uz'),
    'Uzbek Steel',
  );
});

test("contact verifier keeps only contacts published on the official website", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/contacts")) return htmlResponse(`
      <p>Sales: verified@example.com</p>
      <p>Phone: +998 90 123 45 67</p>
      <a href="https://t.me/example_sales">Telegram</a>
      <a href="https://wa.me/998901234567">WhatsApp</a>
    `);
    return htmlResponse(`<a href="/contacts">Contacts</a>`);
  };
  const result = await verifyLeadContacts({
    website: "https://example.com",
    contactEmail: "verified@example.com",
    contactPhone: "+998 90 123 45 67",
    contactTelegram: "https://t.me/example_sales",
    contactWhatsapp: "https://wa.me/998901234567",
    evidence: [{ url: "https://example.com/contacts", title: "Contacts", excerpt: "" }],
  }, { fetchImpl, resolveHost: publicDns });

  assert.ok(result);
  assert.equal(result.contactEmail, "verified@example.com");
  assert.equal(result.contactTelegram, "https://t.me/example_sales");
  assert.equal(result.contactWhatsapp, "https://wa.me/998901234567");
  assert.equal(result.checkedPages, 2);
});

test("contact-page discovery stores the official homepage as the candidate website", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/contacts')) return htmlResponse('<p>sales@example.com</p>');
    return htmlResponse('<title>Example Factory</title><a href="/contacts">Contacts</a>');
  };
  const result = await verifyLeadContacts({
    website: 'https://example.com/contacts', contactEmail: 'sales@example.com',
  }, { fetchImpl, resolveHost: publicDns });
  assert.ok(result);
  assert.equal(result.website, 'https://example.com/');
  assert.ok(result.evidence.some((item) => item.url === 'https://example.com/contacts'));
});

test("contact verifier extracts contacts itself without OpenAI supplied values", async () => {
  const result = await verifyLeadContacts({ website: "https://factory.uz" }, {
    fetchImpl: async () => htmlResponse(`
      <title>Factory — официальный сайт</title>
      <h1>Factory Metal</h1>
      <p>Производим промышленные фитинги в Узбекистане.</p>
      <a href="mailto:sales@factory.uz">sales@factory.uz</a>
      <a href="tel:+998901234567">+998 90 123 45 67</a>
      <a href="https://wa.me/998901234567">WhatsApp</a>
    `),
    resolveHost: publicDns,
  });
  assert.ok(result);
  assert.equal(result.companyName, "Factory Metal");
  assert.equal(result.contactEmail, "sales@factory.uz");
  assert.equal(result.contactWhatsapp, "https://wa.me/998901234567");
  assert.match(result.profileText, /фитинги/);
});

test("contact verifier accepts ordinary percent signs in official page text", async () => {
  const result = await verifyLeadContacts({ website: 'https://percent.uz' }, {
    fetchImpl: async () => htmlResponse('<title>Percent Factory</title><p>100% качество</p><a href="mailto:sales@percent.uz">sales@percent.uz</a>'),
    resolveHost: publicDns,
  });
  assert.ok(result);
  assert.equal(result.contactEmail, 'sales@percent.uz');
});

test("code discovery parses search results, verifies sites and detects country", async () => {
  const searchHtml = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://factory.uz")}">Factory</a>`;
  assert.deepEqual(parseSearchResultUrls(searchHtml), ["https://factory.uz/"]);
  let verified = 0;
  const results = await discoverLeadSites({
    productNames: ["Латунные прутки"], countries: ["Узбекистан"], buyerTypes: ["Заводы"],
  }, 1, new Set(), new AbortController().signal, {
    fetchImpl: async () => htmlResponse(searchHtml),
    verify: async ({ website }) => {
      verified++;
      return {
        website, companyName: "Factory", profileText: "Завод Узбекистан",
        contactEmail: "sales@factory.uz", contactPhone: "+998901234567",
        contactTelegram: "", contactWhatsapp: "", checkedPages: 1,
        verifiedEvidenceUrls: new Set([website]), evidence: [],
      };
    },
  });
  assert.equal(verified, 1);
  assert.equal(results[0]?.country, "Узбекистан");
});

test("Bing redirect results are decoded without sending the redirect to the verifier", () => {
  const target = 'https://factory.kz/contacts';
  const encoded = `a1${Buffer.from(target).toString('base64url')}`;
  const html = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${encoded}">Factory</a></h2></li>`;
  assert.deepEqual(parseBingResultUrls(html), [target]);
});

test("code discovery rejects company directories before OpenAI qualification", async () => {
  const searchHtml = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://catalog.uz/manufacturing")}">Directory</a>`;
  const results = await discoverLeadSites({
    productNames: ["Медные прутки"], countries: ["Узбекистан"], buyerTypes: ["Заводы"],
  }, 1, new Set(), new AbortController().signal, {
    fetchImpl: async () => htmlResponse(searchHtml),
    verify: async ({ website }) => ({
      website, companyName: "Промышленные предприятия Узбекистана",
      profileText: "Каталог и список предприятий Узбекистана", contactEmail: "info@catalog.uz",
      contactPhone: "", contactTelegram: "", contactWhatsapp: "", checkedPages: 1,
      verifiedEvidenceUrls: new Set([website]), evidence: [],
    }),
  });
  assert.deepEqual(results, []);
});

test("contact verifier rejects hallucinated values and keeps the contact actually published", async () => {
  const fetchImpl: typeof fetch = async () => htmlResponse(`
    <p>Phone: +998 90 123 45 67</p>
    <a href="https://wa.me/998901234567">WhatsApp</a>
  `);
  const result = await verifyLeadContacts({
    website: "https://example.com",
    contactEmail: "invented@example.com",
    contactPhone: "+998 90 123 45 67",
    contactWhatsapp: "https://wa.me/998909999999",
  }, { fetchImpl, resolveHost: publicDns });

  assert.ok(result);
  assert.equal(result.contactEmail, "");
  assert.equal(result.contactPhone, "+998 90 123 45 67");
  assert.equal(result.contactWhatsapp, "https://wa.me/998901234567");
});

test("contact verifier blocks private network destinations before fetching", async () => {
  let fetched = false;
  const result = await verifyLeadContacts({
    website: "http://internal.example",
    contactEmail: "sales@internal.example",
  }, {
    fetchImpl: async () => { fetched = true; return htmlResponse("sales@internal.example"); },
    resolveHost: async () => ["127.0.0.1"],
  });
  assert.equal(result, null);
  assert.equal(fetched, false);
});

test("agent startup marks orphaned running searches as failed", async () => {
  let update: any;
  const db = {
    leadSearchRun: {
      updateMany: async (args: any) => { update = args; return { count: 1 }; },
    },
  };
  const controller = new LeadAgentController(db as never, {} as never);
  await controller.onModuleInit();
  assert.deepEqual(update.where, { status: "RUNNING" });
  assert.equal(update.data.status, "FAILED");
  assert.match(update.data.errorMessage, /перезапуска сервера/);
});

test("cancelling a running search aborts work and persists cancellation", async () => {
  let persisted: any;
  const db = {
    leadSearchRun: {
      updateMany: async (args: any) => { persisted = args; return { count: 1 }; },
    },
  };
  const controller = new LeadAgentController(db as never, {} as never);
  const abortController = new AbortController();
  (controller as any).runningSearches.set("0f5f2528-2f19-4c8d-a534-937b900334dd", abortController);
  await controller.cancelRun("0f5f2528-2f19-4c8d-a534-937b900334dd");
  assert.equal(abortController.signal.aborted, true);
  assert.equal(persisted.data.status, "CANCELLED");
});

test("malformed OpenAI responses fail with an actionable error", () => {
  assert.throws(() => parseLeadResponsePayload({ output: [] }), /не вернул результат/);
  assert.throws(() => parseLeadResponsePayload({ output_text: JSON.stringify({ candidates: "wrong" }) }), /некорректный список/);
  assert.deepEqual(parseLeadResponsePayload({ output_text: JSON.stringify({ candidates: [] }) }), []);
});
