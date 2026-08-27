import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const archive = JSON.parse(readFileSync(new URL("./EVIDENCE.json", import.meta.url)));
const name = process.argv[2];
if (!name) console.log(Object.keys(archive.files).join("\n"));
else {
  const member = archive.files[name];
  assert(member, `unknown member: ${name}`);
  const bytes = gunzipSync(Buffer.from(member.gzipBase64, "base64"));
  assert.equal(bytes.length, member.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), member.sha256);
  process.stdout.write(bytes);
}
