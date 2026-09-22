import { existsSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env already exists; preserved.");
  process.exit(0);
}
const password = randomBytes(24).toString("base64url");
writeFileSync(
  ".env",
  `NODE_ENV=development\nPORT=3107\nDATABASE_URL=postgresql://mrba:${password}@127.0.0.1:55439/mrba?schema=public\nPOSTGRES_PASSWORD=${password}\nJWT_SECRET=${randomBytes(48).toString("base64url")}\nRECOVERY_EPOCH=${randomUUID()}\nOWNER_LOGIN=owner\nOWNER_PASSWORD=${randomBytes(24).toString("base64url")}\n`,
  { mode: 0o600 },
);
console.log("Local secrets generated in .env. No secrets printed.");
