import { spawnSync } from "node:child_process";
import { config } from "dotenv";
config({ path: ".env", quiet: true });
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/mrba_test";
const env = { ...process.env, DATABASE_URL: url.toString() };
function run(cmd, args, cwd = process.cwd()) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
run("npm", ["run", "build"]);
run("npx", ["prisma", "migrate", "deploy"], "apps/api");
run("node", ["--env-file=../../.env", "dist/seed.js"], "apps/api");
run("node", [
  "--test",
  "--test-concurrency=1",
  "apps/api/dist/test/api.test.js",
  "apps/api/dist/test/factory.test.js",
]);
