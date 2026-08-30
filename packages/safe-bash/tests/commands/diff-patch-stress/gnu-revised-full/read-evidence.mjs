import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { digest } from "./delta-v1.mjs";

const archive = JSON.parse(readFileSync(new URL("./evidence-archive.json", import.meta.url)));
const name = process.argv[2];
if (!name) console.log(Object.keys(archive.files).join("\n"));
else {
  const record = archive.files[name];
  assert(record, `unknown archived record: ${name}`);
  const bytes = gunzipSync(Buffer.from(record.gzipBase64, "base64"));
  assert.equal(bytes.length, record.bytes);
  assert.equal(digest(bytes), record.sha256);
  process.stdout.write(bytes);
}
