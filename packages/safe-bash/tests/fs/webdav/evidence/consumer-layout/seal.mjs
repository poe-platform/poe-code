import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const root = "/tmp/safe-bash-webdav-consumer-types-zz3ea1";
const destination = "tests/fs/webdav/evidence/consumer-layout";
assert.ok(!existsSync(destination));
const hash = value => createHash("sha256").update(value).digest("hex");
const entries = new Map(), encoded = [];
const put = (path, data) => {
  let content = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (content.length && !content.toString().endsWith("\n")) {
    encoded.push({ path, sha256: hash(content), encoding: "base64", stored: path + ".base64" });
    path += ".base64";
    content = Buffer.from(content.toString("base64") + "\n");
  }
  entries.set(path, content);
};
for (const name of ["REPORT.md", "type-controls.mjs", "seal.mjs", "required-callback.json", "wrong-receiver.json", "wrong-result.json"])
  put(name, readFileSync(join(root, name)));
for (const phase of ["before", "after"]) for (const extension of ["stdout", "stderr", "exit"])
  put(`global-${phase}/typecheck.${extension}`, readFileSync(join(root, `${phase}.${extension}`)));
for (const [phase, folder] of [["intermediate", "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-webdav-public-consumer-IfkfdJ"],
  ["final", "/tmp/safe-bash-webdav-public-consumer-ZevNbp"]]) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) if (entry.isFile())
    put(`${phase}/${entry.name}`, readFileSync(join(folder, entry.name)));
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "manifest-before.json"))), JSON.parse(readFileSync(join(folder, "manifest-after.json"))));
  for (const entry of readdirSync(join(folder, "archive/tests/fs/webdav/consumer")))
    put(`${phase}/consumer/${entry}.txt`, readFileSync(join(folder, "archive/tests/fs/webdav/consumer", entry)));
}
for (const path of ["tests/fs/webdav/consumer/example.ts", "tests/fs/webdav/consumer/provider.ts", "tests/fs/webdav/consumer/consumer.test.ts", "tests/fs/webdav/consumer/README.md"])
  put(`original/${path}.txt`, execFileSync("git", ["show", `408ff59:${path}`]));
for (const path of ["package.json", "tsconfig.json", "dist/fs/webdav/webdav.d.ts"])
  put(`resolution/${path}.txt`, readFileSync(path));
const source = readdirSync("src/fs/webdav").filter(name => name.endsWith(".ts")).sort().map(name => {
  const path = `src/fs/webdav/${name}`;
  const content = readFileSync(path);
  assert.ok(content.equals(execFileSync("git", ["show", `408ff59:${path}`])));
  return { path, sha256: hash(content) };
});
assert.equal(hash(readFileSync("dist/fs/webdav/webdav.d.ts")), "094f357c6317a09d83689328de701fc2d86288ea997552b6cfb9ff351fa80f0f");
put("source-hashes.json", JSON.stringify({ source, currentHead: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  status: execFileSync("git", ["status", "--short"]).toString() }, null, 2) + "\n");
put("encoded-files.json", JSON.stringify(encoded, null, 2) + "\n");
put("SHA256SUMS", [...entries].map(([path, data]) => `${hash(data)}  ${path}\n`).join(""));
let patch = "*** Begin Patch\n";
for (const [path, data] of entries) {
  const text = data.toString("utf8");
  assert.ok(Buffer.from(text).equals(data));
  assert.ok(text === "" || text.endsWith("\n"), path);
  patch += `*** Add File: ${destination}/${path}\n`;
  if (text) patch += text.slice(0, -1).split("\n").map(line => `+${line}\n`).join("");
}
patch += "*** End Patch\n";
execFileSync("apply_patch", [], { input: patch, maxBuffer: 4 * 1024 * 1024 });
for (const [path, data] of entries) assert.ok(readFileSync(join(destination, path)).equals(data), path);
console.log("Sealed evidence files:", entries.size);
