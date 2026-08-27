import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith("file:") && url.includes("/dist/")) {
    assert.ok(url.startsWith(process.env.INDEPENDENT_PACKAGE_URL), `unexpected emitted product: ${url}`);
    const bytes = readFileSync(fileURLToPath(url));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (result.source !== null && result.source !== undefined) {
      assert.equal(createHash("sha256").update(result.source).digest("hex"), sha256);
    }
    appendFileSync(process.env.INDEPENDENT_LOAD_LOG, JSON.stringify({ url, sha256, bytes: bytes.length }) + "\n");
  }
  return result;
}
