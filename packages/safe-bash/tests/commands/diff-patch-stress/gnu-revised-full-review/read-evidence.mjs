import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const archive = JSON.parse(readFileSync(new URL("./evidence-archive.json", import.meta.url)));
const name = process.argv[2];
if (!name) console.log(Object.keys(archive.files).join("\n"));
else {
  const entry = archive.files[name];
  assert(entry, `unknown evidence member: ${name}`);
  const bytes = gunzipSync(Buffer.from(entry.gzipBase64, "base64"));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  process.stdout.write(bytes);
}
