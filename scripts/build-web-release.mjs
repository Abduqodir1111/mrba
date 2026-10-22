import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { checkWebRelease } from "./web-release-check.mjs";
const { validateReleaseApiUrl } = createRequire(import.meta.url)("../apps/mobile/release-config.cjs");
const apiUrl = validateReleaseApiUrl(process.env.EXPO_PUBLIC_API_URL ?? "https://api.mrba.uz/api/v1");
const output = resolve(process.argv[2] ?? "artifacts/web-release");
const result = spawnSync("npx", ["expo", "export", "--platform", "web", "--clear", "--output-dir", output], {
  cwd: fileURLToPath(new URL("../apps/mobile", import.meta.url)),
  env: { ...process.env, MRBA_RELEASE: "1", EXPO_PUBLIC_API_URL: apiUrl },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("PASS compiled web API: " + checkWebRelease(output, apiUrl));
