import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { entries, fileHash, git, guard, hashProcess, hashStream, inventory, json, limits, materialize, objectId, safePath, sha256, validateInputBytes, validateLinkBytes, validateTree } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "../../../..");
guard(process.argv.length === 5, "CLI", "controls.mjs BINDINGS.json SHA256 NEW_OUTPUT_DIRECTORY");
const bindingPath = resolve(process.argv[2]), bindingBytes = readFileSync(bindingPath);
guard(sha256(bindingBytes) === process.argv[3], "BINDING_HASH");
const binding = JSON.parse(bindingBytes), output = resolve(process.argv[4]);
mkdirSync(output);
const scratch = mkdtempSync(join(tmpdir(), "html-admission-v2-controls-"));
const tree = entries(repository, binding.candidate);
const overGiB = { bytes: 1073872896, sha256: "f5b4c8bf0f2f882ef51effdb305a5edf1c8c657d05ba2fd7594c679478fe668f", description: "1GiB+128KiB of byte0x61, no stored large fixture" };
const fixture = join(here, "stream-fixture.mjs");
json(join(output, "PRE.json"), { at: new Date().toISOString(), argv: process.argv, scratch, bindingSha256: sha256(bindingBytes), codeAndInputs: inventory(here), node: { path: process.execPath, sha256: fileHash(process.execPath), version: process.version }, gitSha256: fileHash("/usr/bin/git"), fixtureSha256: fileHash(fixture), overGiB, limits, execution: "harness-only controls, no candidate runtime/compiler/npm" });
const rows = [];
async function check(name, boundary, operation) {
  const row = { name, expectedBoundary: boundary ?? "positive", started: new Date().toISOString() };
  try {
    const result = await operation();
    if (boundary) throw new Error(`negative did not reject: ${boundary}`);
    row.status = "pass";
    if (result !== undefined) row.result = result;
  } catch (error) {
    row.error = { name: error.name, message: error.message, code: error.code, stack: error.stack, process: error.process };
    row.status = boundary && error.code === boundary ? "pass" : "fail";
  }
  row.finished = new Date().toISOString();
  rows.push(row);
  json(join(output, `${String(rows.length).padStart(3, "0")}-${name}.json`), row);
}
const mutateTree = callback => { const copy = structuredClone(tree); callback(copy); return copy; };
await check("exact-metadata-and410-inputs", null, () => ({ entries: validateTree(tree, binding.links, binding.inputs).size, inputs: binding.inputs.length, links: Object.keys(binding.links).length }));
for (const [name, value] of [["traversal", "safe/../escape"], ["absolute", "/escape"], ["nul", "safe\0escape"], ["empty-segment", "safe//escape"], ["dot", "safe/./escape"], ["git-admin", ".git/config"], ["windows-drive", "C:/escape"], ["backslash-build", "safe\\escape"], ["newline-build", "safe\nescape"]]) {
  await check(`path-${name}`, "PATH", () => safePath(value));
}
await check("tree-traversal-before-admission", "PATH", () => validateTree(mutateTree(copy => { copy[0].path = "../escape"; }), binding.links, binding.inputs));
await check("unknown-historical-link", "UNKNOWN_LINK", () => validateTree([...tree, { path: "tests/unlisted-link", mode: "120000", type: "blob", blob: Object.values(binding.links)[0].gitBlob }], binding.links, binding.inputs));
await check("executable-build-link", "BUILD_LINK", () => validateTree([...tree, { path: "scripts/evil.mjs", mode: "120000", type: "blob", blob: Object.values(binding.links)[0].gitBlob }], binding.links, binding.inputs));
const firstLink = tree.find(entry => entry.mode === "120000"), firstInput = binding.inputs[0];
await check("necessary-historical-link", "BUILD_LINK", () => validateTree(tree, binding.links, [...binding.inputs, { ...firstLink, sha256: binding.links[firstLink.path].sha256 }]));
await check("missing-known-link", "LINK_MISSING", () => validateTree(tree.filter(entry => entry.path !== firstLink.path), binding.links, binding.inputs));
await check("wrong-link-git-mode", "MODE", () => validateTree(mutateTree(copy => { copy.find(entry => entry.path === firstLink.path).mode = "160000"; }), binding.links, binding.inputs));
await check("wrong-link-blob", "LINK_IDENTITY", () => validateTree(mutateTree(copy => { copy.find(entry => entry.path === firstLink.path).blob = "0".repeat(40); }), binding.links, binding.inputs));
await check("wrong-literal-link-target", "LINK_BYTES", () => validateLinkBytes(firstLink, binding.links[firstLink.path], Buffer.from("not-the-literal-target")));
await check("exact-literal-link-target", null, () => { validateLinkBytes(firstLink, binding.links[firstLink.path], Buffer.from(binding.links[firstLink.path].targetBase64, "base64")); return { mode: firstLink.mode, path: firstLink.path }; });
await check("wrong-input-mode", "INPUT_MODE", () => validateTree(mutateTree(copy => { copy.find(entry => entry.path === firstInput.path).mode = "100755"; }), binding.links, binding.inputs));
await check("wrong-input-blob", "INPUT_BLOB", () => validateTree(mutateTree(copy => { copy.find(entry => entry.path === firstInput.path).blob = "0".repeat(40); }), binding.links, binding.inputs));
await check("missing-input-before-materialization", "INPUT_MISSING", () => materialize(repository, join(scratch, "never-created"), tree.filter(entry => entry.path !== firstInput.path), binding.links, binding.inputs));
await check("duplicate-input", "INPUT_DUPLICATE", () => validateTree(tree, binding.links, [...binding.inputs, firstInput]));
await check("duplicate-tree-entry", "TREE_DUPLICATE", () => validateTree([...tree, tree[0]], binding.links, binding.inputs));
const bytes = Buffer.from("fixture"), tiny = { path: "fixture", mode: "100644", type: "blob", blob: objectId("blob", bytes), sha256: sha256(bytes) };
await check("wrong-content-sha256", "INPUT_HASH", () => validateInputBytes({ ...tiny, sha256: "0".repeat(64) }, bytes));
await check("wrong-content-git-hash", "INPUT_HASH", () => validateInputBytes(tiny, Buffer.from("corrupted")));
await check("materialized-symlink-rejected", "MATERIALIZED_LINK", () => { const directory = join(scratch, "link-view"); mkdirSync(directory); symlinkSync("missing", join(directory, "link")); inventory(directory); });
await check("original-frozen-inventory-still-rejects", null, async () => {
  const path = "tests/integration/html-public-independent-20260827/contract.mjs";
  const code = git(repository, ["show", `${binding.freeze}:${path}`]);
  assert.equal(sha256(code), binding.fixtures.find(entry => entry.path === path).sha256);
  const frozen = await import(`data:text/javascript;base64,${code.toString("base64")}`);
  let observed;
  try { frozen.inventory(join(scratch, "link-view")); } catch (error) { observed = error; }
  assert.ok(observed instanceof assert.AssertionError);
  assert.match(observed.message, /symlink forbidden in authenticated tree: link/u);
  return { attribution: "NEW harness-only synthetic rejection by exact frozen contract; NOT recovered original candidate rejection", raw: { name: observed.name, code: observed.code, message: observed.message, stack: observed.stack } };
});
await check("source-stream-error-exact", "FIXTURE_SOURCE", () => hashStream((async function* () { yield Buffer.from("x"); throw Object.assign(new Error("fixture source failed"), { code: "FIXTURE_SOURCE" }); })(), { expectedBytes: 1, expectedSha256: sha256(Buffer.from("x")) }));
await check("oversized-producer-chunk", "STREAM_CHUNK", () => hashStream((async function* () { yield Buffer.alloc(limits.producerChunkBytes + 1); })(), { expectedBytes: limits.producerChunkBytes + 1, expectedSha256: "0".repeat(64) }));
await check("over1GiB-positive-backpressure", null, async () => {
  let pending = 0, maximum = 0;
  const result = await hashProcess(process.execPath, ["--max-old-space-size=96", fixture, String(overGiB.bytes)], {}, { expectedBytes: overGiB.bytes, expectedSha256: overGiB.sha256, consume: async () => { pending++; maximum = Math.max(maximum, pending); await setImmediate(); pending--; } });
  const producer = JSON.parse(result.process.stderr.trim());
  assert.equal(maximum, 1);
  assert.ok(producer.drains > 0);
  assert.equal(producer.emitted, overGiB.bytes);
  assert.ok(result.maxChunkBytes <= limits.chunkBytes);
  assert.ok(result.maxRssBytes < 256 * 1024 ** 2);
  return { ...result, producer, consumerMaximumPending: maximum, sampledRssCeilingBytes: 256 * 1024 ** 2 };
});
await check("over1GiB-wrong-hash", "STREAM_HASH", () => hashProcess(process.execPath, [fixture, String(overGiB.bytes)], {}, { expectedBytes: overGiB.bytes, expectedSha256: "0".repeat(64) }));
await check("over1GiB-short-stream", "STREAM_SIZE", () => hashProcess(process.execPath, [fixture, String(overGiB.bytes - 65536)], {}, { expectedBytes: overGiB.bytes, expectedSha256: overGiB.sha256 }));
await check("over1GiB-hard-limit", "STREAM_LIMIT", () => hashProcess(process.execPath, [fixture, String(overGiB.bytes + 65536)], {}, { expectedBytes: overGiB.bytes, expectedSha256: overGiB.sha256, maxBytes: overGiB.bytes }));
await check("over1GiB-child-exit-checked", "STREAM_PROCESS", () => hashProcess(process.execPath, [fixture, String(overGiB.bytes), "7"], {}, { expectedBytes: overGiB.bytes, expectedSha256: overGiB.sha256 }));
const summary = { at: new Date().toISOString(), controls: rows.length, passed: rows.filter(row => row.status === "pass").length, failed: rows.filter(row => row.status === "fail").length, candidateRuntimeCasesExecuted: 0, compilerOrNpmExecuted: false, scratch, raw: Object.fromEntries(Object.entries(inventory(output))) };
json(join(output, "SUMMARY.json"), summary);
console.log(JSON.stringify(summary));
process.exitCode = summary.failed ? 1 : 0;
