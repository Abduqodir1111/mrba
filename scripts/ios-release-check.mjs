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
  const resolved = require("../apps/mobile/app.config.js")({ config: expo });
  const scenes = resolved.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
  );
  if (scenes?.[1]?.ios?.enableSceneSupport !== true)
    throw new Error(
      "Для запуска на iOS 27 требуется ios.enableSceneSupport=true.",
    );
  if (process.argv.includes("--native")) {
    const plist = readFileSync(
      new URL("../apps/mobile/ios/MRBA/Info.plist", import.meta.url),
      "utf8",
    );
    const delegate = readFileSync(
      new URL("../apps/mobile/ios/MRBA/AppDelegate.swift", import.meta.url),
      "utf8",
    );
    if (
      !plist.includes("UIApplicationSceneManifest") ||
      !plist.includes("EXExpoAppSceneDelegate") ||
      !delegate.includes("ExpoReactNativeFactoryProvider") ||
      delegate.includes("factory.startReactNative(")
    )
      throw new Error(
        "Нативный проект использует устаревший запуск. Выполните Expo prebuild с поддержкой UIScene.",
      );
    console.log("Нативный запуск UIScene проверен.");
  }
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
