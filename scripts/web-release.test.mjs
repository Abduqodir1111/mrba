import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWebRelease } from "./web-release-check.mjs";

const api = "https://api.mrba.uz/api/v1";
test("web release checks the emitted API URL and rejects cached local transforms", () => {
  const directory = mkdtempSync(join(tmpdir(), "mrba-web-release-"));
  const file = join(directory, "entry.js");
  try {
    writeFileSync(file, `const api = '${api}';`);
    assert.equal(checkWebRelease(directory, api), api);
    for (const local of ["http://127.0.0.1:3107/api/v1", "http://192.168.1.242:3107/api/v1", "http://localhost:3107/api/v1"]) {
      writeFileSync(file, `const cached = '${local}';`);
      assert.throws(() => checkWebRelease(directory, api));
      writeFileSync(file, `const api = '${api}', cached = '${local}';`);
      assert.throws(() => checkWebRelease(directory, api));
    }
    writeFileSync(file, "const api = ''; ");
    assert.throws(() => checkWebRelease(directory, api));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
