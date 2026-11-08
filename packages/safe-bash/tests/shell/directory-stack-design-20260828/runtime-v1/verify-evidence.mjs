import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const seal = JSON.parse(fs.readFileSync(path.join(own, "SEAL.json"), "utf8"));
for (const [name, expected] of Object.entries(seal.artifacts)) assert.equal(digest(fs.readFileSync(path.join(own, name))), expected, name);
const records = ["01", "02", "03", "04"].map(version => JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(own, `candidate-${version}.json.gz.base64`), "utf8"), "base64"))));
const data = records.at(-1);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 96 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const refs = data.inputs.map(input => `${input.commit}:${input.name}`);
const requested = spawnSync("git", ["cat-file", "--batch"], { cwd: repository, input: refs.join("\n") + "\n", maxBuffer: 96 * 1024 * 1024 });
assert.equal(requested.status, 0);
let cursor = 0;
for (const input of data.inputs) {
  const end = requested.stdout.indexOf(10, cursor), header = requested.stdout.subarray(cursor, end).toString().split(" ");
  assert.equal(header[1], "blob"); assert.equal(header[0], input.gitBlob);
  const length = Number(header[2]), bytes = requested.stdout.subarray(end + 1, end + 1 + length);
  cursor = end + 2 + length;
  assert.equal(digest(bytes), input.originalSha256, input.name);
  const selected = data.sourceBlobs[input.name] ? Buffer.from(data.sourceBlobs[input.name].base64, "base64") : bytes;
  assert.equal(digest(selected), input.sha256, input.name);
  if (input.name.startsWith("src/")) assert.equal(data.sourceBefore[input.name.slice(4)].sha256, input.sha256);
}
assert.equal(cursor, requested.stdout.length);
for (const [name, source] of Object.entries(data.sourceBlobs)) {
  assert.equal(digest(Buffer.from(source.base64, "base64")), source.sha256);
  assert.equal(digest(git("show", `${seal.sourceCommit}:${name}`)), source.sha256);
  assert.equal(source.sha256, seal.sources[name]);
}
for (const [name, artifact] of Object.entries(data.authorInputs)) {
  assert.equal(digest(Buffer.from(artifact.base64, "base64")), artifact.sha256);
  assert.equal(digest(git("show", `${seal.sourceCommit}:${path.relative(repository, path.join(own, name))}`)), artifact.sha256);
}
const changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", seal.sourceCommit).toString().trim().split("\n");
assert.deepEqual(changed.filter(name => name.startsWith("src/")), ["src/shell/runtime.ts", "src/shell/shell.ts"]);
for (const record of records) {
  assert.equal(record.failure, undefined);
  assert.equal(record.temporaryRemoved, true); assert.equal(fs.existsSync(record.root), false);
  for (const [name, source] of Object.entries(record.sourceBlobs)) assert.equal(source.sha256, seal.sources[name]);
  assert.equal(record.sourceStable, true);
}
assert.equal(records[0].commands[0].counts.fail, 25);
assert.equal(records[0].commands[1].status, 2);
assert.equal(records[1].commands[0].counts.pass, 82);
assert.equal(records[2].commands[0].counts.pass, 82);
assert.equal(data.commands[0].counts.pass, 87);
for (const command of data.commands) {
  assert.equal(command.error, null); assert.equal(command.signal, null);
  if (!command.expectedRejection) assert.equal(command.status, 0, command.name);
}
assert.equal(data.unchangedMembers.length, 56);
assert.equal(data.unchangedTopLevel.length, 60);
assert.equal(data.package.sha256, seal.packageSha256);
const packed = Buffer.from(data.package.base64, "base64");
assert.equal(digest(packed), data.package.sha256);
assert.equal(records[2].package.sha256, data.package.sha256);
const tar = gunzipSync(packed);
const members = new Set();
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) { assert.ok(tar.subarray(offset).every(byte => byte === 0)); break; }
  const text = (start, end) => header.subarray(start, end).toString().split("\0")[0];
  const name = text(0, 100), prefix = text(345, 500);
  const full = prefix ? `${prefix}/${name}` : name;
  assert.ok(full.startsWith("package/")); assert.ok(!full.split("/").includes(".."));
  const relative = full.slice(8);
  assert.equal(members.has(relative), false); members.add(relative);
  assert.equal(header[156], 48, "regular files only in this admitted package");
  const size = parseInt(text(124, 136).trim(), 8);
  assert.ok(Number.isSafeInteger(size) && size >= 0);
  const content = tar.subarray(offset + 512, offset + 512 + size);
  assert.equal(content.length, size);
  assert.equal(digest(content), data.packageInventory[relative]?.sha256, relative);
  assert.equal(parseInt(text(100, 108).trim(), 8) & 0o777, data.packageInventory[relative].mode);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(members.size, 846);
assert.deepEqual([...members].sort(), Object.entries(data.packageInventory).filter(([, value]) => !value.directory).map(([name]) => name).sort());
assert.ok(members.has("README.md") && members.has("package.json"));
for (const layout of data.layouts) {
  assert.equal(layout.status, 0); assert.equal(layout.typesStatus, 0);
  assert.equal(new Set(layout.loads.map(load => load.relative)).size, 207);
  for (const load of layout.loads) assert.equal(load.sha256, data.packageInventory[load.relative].sha256);
}
console.log(JSON.stringify({ verified: true, sourceCommit: seal.sourceCommit, pinnedInputs: data.inputs.length, fullPackageFiles: members.size, packageSha256: data.package.sha256, stackPerLayout: 87, layouts: ["source", "installed", "moved"], originalFailuresRetained: true, proofRole: "recorded evidence and byte authentication only; no product/native replay", independentAcceptance: false }));
