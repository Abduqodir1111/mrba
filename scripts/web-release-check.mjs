import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const { validateReleaseApiUrl } = createRequire(import.meta.url)("../apps/mobile/release-config.cjs");

// Check emitted JavaScript, not just build environment: Metro can reuse an
// earlier transform containing a development API URL.
export function checkWebRelease(directory, apiUrl) {
  const expected = validateReleaseApiUrl(apiUrl);
  const urls = new Set();
  function scan(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.name.endsWith(".js")) {
        const source = readFileSync(file, "utf8");
        for (const url of source.match(/https?:\/\/[A-Za-z0-9.\[\]:-]+\/api\/v1/g) ?? []) urls.add(url);
      }
    }
  }
  scan(directory);
  if (!urls.has(expected)) throw Error("В готовой веб-сборке не найден production API: " + expected);
  for (const url of urls) {
    if (validateReleaseApiUrl(url) !== expected) throw Error("Посторонний адрес API в веб-сборке: " + url);
  }
  return expected;
}
