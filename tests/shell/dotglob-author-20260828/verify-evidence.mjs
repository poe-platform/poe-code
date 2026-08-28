import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const seal = JSON.parse(fs.readFileSync(path.join(own, "SEAL.json")));
for (const [name, digest] of Object.entries(seal.artifacts)) assert.equal(sha(fs.readFileSync(path.join(own, name))), digest, name);
const records = seal.captures.map(entry => {
  const compressed = Buffer.from(fs.readFileSync(path.join(own, entry.path), "utf8"), "base64");
  const bytes = gunzipSync(compressed);
  assert.equal(sha(bytes), entry.jsonSha256);
  return JSON.parse(bytes);
});
const final = records.find(record => record.capture === seal.finalCapture).result;
assert.equal(final.success, true);
assert.equal(final.acceptedTree, "099455f232870fa1ea59e1a0ae482e003fd170db");
assert.equal(final.candidateComposedTree, seal.candidateComposedTree);
assert.equal(final.acceptedPackage.sha256, "15aa8d8dd6e78a9b7d12156ea2adaf93bd5f0037f13443e8928268c9d5215a18");
assert.equal(final.acceptedPackage.files, 846);
for (const input of final.inputs) {
  const original = git("show", `${input.commit}:${input.path}`);
  assert.equal(sha(original), input.sha256);
  assert.equal(blob(original), input.blob);
  const selected = final.sourceBlobs[input.path] ? Buffer.from(final.sourceBlobs[input.path].base64, "base64") : original;
  assert.equal(sha(selected), input.selectedSha256);
  assert.equal(blob(selected), input.selectedBlob);
}
for (const [name, binding] of Object.entries(final.sourceBlobs)) {
  const source = git("show", `${seal.sourceCommit}:${name}`);
  assert.equal(blob(source), binding.blob);
  assert.equal(sha(source), binding.sha256);
  assert.deepEqual(source, Buffer.from(binding.base64, "base64"));
  let stripped = source.toString();
  if (name.endsWith("runtime.ts")) {
    const start = stripped.indexOf("  private async shoptBuiltin(");
    const end = stripped.indexOf("  async builtin(", start);
    assert(start > 0 && end > start);
    stripped = stripped.slice(0, start) + stripped.slice(end);
    for (const [before, after] of [
      ['"popd", "shopt",', '"popd",'],
      ["  dotglob?: boolean;\n", ""],
      ["      dotglob: false,\n", ""],
      ['    if (command === "shopt") return this.shoptBuiltin(context, state);\n', ""],
      ['entry.name !== "." && entry.name !== ".." && (state.dotglob || !entry.name.startsWith(".") || segment.startsWith("."))', '(!entry.name.startsWith(".") || segment.startsWith("."))'],
    ]) { assert.equal(stripped.split(before).length, 2); stripped = stripped.replace(before, after); }
  } else {
    const initializer = "          dotglob: false,\n";
    assert.equal(stripped.split(initializer).length, 2);
    stripped = stripped.replace(initializer, "");
  }
  assert.equal(blob(Buffer.from(stripped)), binding.base, "only declared dotglob delta admitted");
}
const test = git("show", `${seal.sourceCommit}:${final.authorTest.path}`);
assert.equal(sha(test), final.authorTest.sha256);
assert.deepEqual(test, Buffer.from(final.authorTest.base64, "base64"));
const driver = git("show", `${seal.driverCommit}:tests/shell/dotglob-author-20260828/validate.mjs`);
assert.equal(sha(driver), final.driver.sha256);
assert.equal(final.candidateCommit, seal.sourceCommit);
const packageBytes = Buffer.from(final.package.base64, "base64");
assert.equal(sha(packageBytes), seal.packageSha256);
assert.equal(sha(packageBytes), final.package.sha256);
const tar = gunzipSync(packageBytes), members = new Map();
for (let offset = 0; offset < tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  assert.equal(header.length, 512);
  if (header.every(byte => byte === 0)) { assert(tar.subarray(offset).every(byte => byte === 0)); break; }
  const text = (start, size) => header.subarray(start, start + size).toString().replace(/\0.*$/s, "");
  const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
  assert(name.startsWith("package/") && !name.split("/").includes(".."));
  const key = name.slice(8), size = Number.parseInt(text(124, 12).trim(), 8), mode = Number.parseInt(text(100, 8).trim(), 8);
  const expectedChecksum = Number.parseInt(text(148, 8).trim(), 8);
  let checksum = 0;
  for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
  assert.equal(checksum, expectedChecksum);
  assert(header[156] === 48 || header[156] === 0, "regular package members only");
  assert(!members.has(key));
  const bytes = tar.subarray(offset + 512, offset + 512 + size);
  assert.equal(bytes.length, size);
  assert.deepEqual({ bytes: size, mode: mode & 0o777, sha256: sha(bytes) }, final.packageInventory[key]);
  members.set(key, bytes);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(members.size, 846);
assert.deepEqual([...members.keys()].sort(), final.package.metadata.files.map(entry => entry.path).sort());
assert.equal(Object.keys(JSON.parse(members.get("package.json")).dependencies ?? {}).length, 0);
for (const [layout, count] of [["source-dotglob", 272], ["installed-dotglob", 272], ["moved-dotglob", 272], ["source-glob-invoke-regressions", 14], ["source-stack-regressions", 87]]) {
  const command = final.commands.find(entry => entry.label === layout);
  assert.equal(command.status, 0);
  assert(command.stdout.includes(`# tests ${count}\n`));
  assert(command.stdout.includes(`# pass ${count}\n`));
  for (const outcome of ["fail", "cancelled", "skipped", "todo"]) assert(command.stdout.includes(`# ${outcome} 0\n`));
}
for (const record of final.commands) { assert.equal(record.signal, null); assert.equal(record.error, null); }
for (const layout of ["installed", "moved"]) {
  const entries = records.find(record => record.capture === seal.finalCapture).traces[layout].trim().split("\n").map(line => JSON.parse(line));
  assert.equal(new Set(entries.map(entry => entry.key)).size, 207);
  for (const entry of entries) assert.equal(entry.sha256, final.packageInventory[entry.key].sha256);
}
assert.equal(final.layouts.moved.oldPathAbsent, true);
assert.equal(final.sourceStableIncludingNewEntries, true);
assert.equal(final.nativeRuns, 0);
process.stdout.write(JSON.stringify({ status: "static-evidence-pass", sourceCommit: seal.sourceCommit, selectedInputs: final.inputs.length, candidateComposedTree: seal.candidateComposedTree, packageSha256: seal.packageSha256, packageFiles: members.size, captures: records.length, runtimeReplay: false }) + "\n");
