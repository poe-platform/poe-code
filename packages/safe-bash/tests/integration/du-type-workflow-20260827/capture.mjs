import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const owned = fileURLToPath(new URL("./", import.meta.url));
const runs = process.argv.slice(2).map(path => resolve(path));
assert.ok(runs.length > 0, "supply completed, unique replay output directories");
const files = [];
for (const run of runs) {
  const collect = local => {
    for (const entry of readdirSync(join(run, local), { withFileTypes: true })) {
      const path = local ? `${local}/${entry.name}` : entry.name;
      if (entry.isDirectory() && ["typecheck-all", "node22-permission"].includes(path)) collect(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push({ path: `${basename(run)}/${path}`, text: readFileSync(join(run, path), "utf8") });
    }
  };
  collect("");
}
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const payload = Buffer.from(JSON.stringify(files));
const manifest = { schema: 1, encoding: "gzip-base64 JSON array of unchanged UTF-8 evidence files", payloadSha256: sha256(payload), files: files.map(file => ({ path: file.path, bytes: Buffer.byteLength(file.text), sha256: sha256(Buffer.from(file.text)) })) };
const additions = {
  "data/EVIDENCE.json.gz.base64": gzipSync(payload).toString("base64").match(/.{1,120}/gu).join("\n") + "\n",
  "data/MANIFEST.json": JSON.stringify(manifest, null, 2) + "\n",
};
for (const path of Object.keys(additions)) assert.equal(existsSync(join(owned, path)), false, `capture refuses existing evidence: ${path}`);
const patch = "*** Begin Patch\n" + Object.entries(additions).map(([path, text]) => `*** Add File: ${join(owned, path)}\n${text.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n`).join("") + "*** End Patch\n";
execFileSync("apply_patch", [], { input: patch, maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ files: files.length, payloadBytes: payload.length, payloadSha256: manifest.payloadSha256 }));
