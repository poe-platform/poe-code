import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = process.env.HTML_FIXTURE_ROOT;
const expected = JSON.parse(readFileSync(`${root}/load-map.json`));
let records = 0;
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith("file:")) {
    const path = relative(root, fileURLToPath(url));
    const bytes = typeof result.source === "string" ? Buffer.from(result.source) : Buffer.from(result.source ?? []);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, expected[path], `BOUNDARY:ACTUAL_LOAD_HASH:${path}`);
    assert.ok(++records <= 4096, "BOUNDARY:LOAD_RECORD_LIMIT");
    writeSync(2, `HTML_ACTUAL_LOAD:${JSON.stringify({ path, url, sha256, bytes: bytes.length })}\n`);
  }
  return result;
}
