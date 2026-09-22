import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { validateReleaseApiUrl } = require("../apps/mobile/release-config.cjs");
try {
  validateReleaseApiUrl(process.env.EXPO_PUBLIC_API_URL);
  const { expo } = JSON.parse(
    readFileSync(new URL("../apps/mobile/app.json", import.meta.url)),
  );
  if (expo.ios.bundleIdentifier !== "uz.mrba.factory")
    throw new Error("Проверьте Bundle ID MRBA.");
  console.log(
    `Локальная конфигурация: ${expo.name} ${expo.version}, ${expo.ios.bundleIdentifier}. HTTPS API задан.`,
  );
  console.log(
    "Это не подтверждает доступность сервера, Apple-подпись или готовность App Review. См. docs/app-store/README.md.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
