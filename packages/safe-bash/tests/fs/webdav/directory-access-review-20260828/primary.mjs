import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const output = new URL("primary.json", import.meta.url);
assert.equal(fs.existsSync(output), false);
const records = [];
for (const [name, sections] of [
  ["rfc4918", [/^9\.1\. /, /^9\.1\.1\. /, /^15\.9\. /, /^20\. /]],
  ["rfc3744", [/^3\.1\. /, /^3\.1\.1\. /, /^5\.4\. /]],
]) {
  const url = `https://www.rfc-editor.org/rfc/${name}.txt`;
  try {
    const response = await fetch(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length < 1024 * 1024);
    const lines = bytes.toString().split("\n");
    records.push({ name, url, status: response.status, retrievedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
      excerpts: sections.map(pattern => {
        const start = lines.findIndex(line => pattern.test(line));
        assert.ok(start >= 0, `${name} ${pattern}`);
        return { pattern: String(pattern), line: start + 1, text: lines.slice(start, start + 44).join("\n") };
      }) });
  } catch (error) { records.push({ name, url, failedAt: new Date().toISOString(), failure: { name: error?.name, message: error?.message } }); }
}
fs.writeFileSync(output, JSON.stringify(records, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(records.map(({ name, sha256, failure }) => ({ name, sha256, failure })), null, 2));
