import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { directory, repository, owner, candidate, priorRecipe, legacyDirectory, digest, objectHash, read, json, inventory } from "./common.mjs";
import { gitExecutable, environment, validateRow } from "./stream-reader.mjs";

const node22 = "/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node";
assert.equal(process.execPath, node22);
assert.equal(digest(read(node22)), "5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011");
assert.equal(digest(read(gitExecutable)), "be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae");
const git = (...args) => execFileSync(gitExecutable, ["--no-replace-objects", "--literal-pathspecs", ...args], { cwd: repository, env: environment, maxBuffer: 131072 });
const tree = (commit, paths) => git("ls-tree", "-rlz", commit, "--", ...paths).toString().split("\0").filter(Boolean).map(line => {
  const [attributes, path] = line.split("\t"), [mode, type, objectId, bytes] = attributes.trim().split(/\s+/u);
  return { commit, path, mode, type, objectId, bytes: Number(bytes) };
});
const catalog = [], add = (row, sha256) => { const value = { ...row, sha256 }; validateRow(value); if (!catalog.some(existing => existing.commit === row.commit && existing.path === row.path)) catalog.push(value); return value; };
function localTree(commit, paths) {
  for (const row of tree(commit, paths)) {
    const bytes = read(join(repository, row.path));
    assert.equal(bytes.length, row.bytes); assert.equal(objectHash(bytes), row.objectId, row.path);
    assert.equal(lstatSync(join(repository, row.path)).mode & 0o777, 0o644);
    add(row, digest(bytes));
  }
}
localTree(priorRecipe, [`${owner}/component-execution-v1`]);
localTree("f8b982f09e51b9a0a073b0b7bb393cb54796dd62", [owner]);
localTree("a0142c7711c4be2cc33384c87bd6d8dea9e3d07d", [`${owner}/component-admission-v1`]);
localTree("e87d3f16d9688d2449050ebc66f50ac93eb9c17b", [`${owner}/component-execution-v2`]);
const inputs = json(join(legacyDirectory, "INPUTS.json"));
const admission = json(join(repository, owner, "component-admission-v1/AUTHENTICATION.json"));
assert.equal(digest(read(join(repository, owner, "component-admission-v1/ADDENDUM.md"))), "d4c894e971725f0a6b0ee6f8d6c20f8ad3d39a63c9ac8aa114788474e898d1b7");
assert.equal(git("rev-parse", `${candidate}^{tree}`).toString().trim(), "5905cf8d43233c68ea2bd499275ada2641223d9a");
const selected = tree(candidate, admission.selectedSourceInventory.selection);
assert.deepEqual(selected.map(({ path, mode, type, objectId }, index) => ({ path, mode, type, gitBlob: objectId, sha256: inputs.selected[index]?.sha256 })), inputs.selected);
assert.equal(selected.length, 357);
selected.forEach((row, index) => add(row, inputs.selected[index].sha256));
const original = read(join(repository, owner, "consumer.mjs")).toString();
assert.equal(original.split(inputs.delta.previous).length, 2);
assert.equal(original.replace(inputs.delta.previous, inputs.delta.replacement), read(join(legacyDirectory, "consumer-component.mjs")).toString());
assert.equal(digest(read(join(legacyDirectory, "observer.mjs"))), "1fffd7e99be072e87127be1af56461334a6db529d37c8be38b5418762548e37c");
assert.equal(digest(read(join(legacyDirectory, "silent-worker.mjs"))), "fbd03925f44cda3e46a012e3060e4c2e5547773dc4c26ca40a0dcb53bc5ef9ed");
for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
for (const runtime of inputs.runtimes) assert.equal(digest(read(runtime.executable)), runtime.sha256);
const pack = read(inputs.package.authorTarballLocation);
assert.equal(pack.length, 727526); assert.equal(digest(pack), inputs.package.tarballSha256);
const tar = gunzipSync(pack, { maxOutputLength: 16 * 1024 * 1024 }), members = new Map();
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
  const text = (start, size) => header.subarray(start, start + size).toString().replace(/\0.*$/su, "");
  const prefix = text(345, 155), name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
  assert.ok(name.startsWith("package/")); assert.ok([0, 48].includes(header[156]));
  const path = name.slice(8), size = Number.parseInt(text(124, 12).trim(), 8), bytes = tar.subarray(offset + 512, offset + 512 + size);
  assert.equal(bytes.length, size); assert.ok(!members.has(path)); assert.equal(digest(bytes), inputs.packageFiles[path], path); members.set(path, bytes);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(members.size, 834);
const layouts = json(join(legacyDirectory, "LAYOUTS.json"));
const remap = value => value.replaceAll(legacyDirectory, directory);
const layoutDeltas = layouts.layouts.map(layout => {
  const expected = Object.fromEntries(Object.entries(layout.expected).map(([path, sha256]) => [remap(path), sha256]));
  let poisonEntrypointSha256;
  if (layout.forbiddenSource) {
    poisonEntrypointSha256 = digest(members.get("dist/index.js").toString() + `\nimport ${JSON.stringify(remap(layout.forbiddenSource))};\n`);
    expected[join(remap(layout.consumer), "node_modules/virtual-bash/dist/index.js")] = poisonEntrypointSha256;
  }
  return { name: layout.name, expectedSha256: digest(JSON.stringify(expected)), poisonEntrypointSha256 };
});
const tools = [gitExecutable, ...inputs.runtimes.map(row => row.executable)].map(path => ({ path, bytes: lstatSync(path).size, mode: lstatSync(path).mode & 0o777, sha256: digest(read(path)) }));
const pin = { schema: "expr-reader-v3-input-catalog/1", preparedAt: new Date().toISOString(), authorizationDate: "2026-08-28", candidate, tree: inputs.tree, priorRecipe,
  checkpoint: "e87d3f16d9688d2449050ebc66f50ac93eb9c17b", selectedCount: selected.length, catalog, tools, layoutDeltas,
  retainedJSON: { path: `${owner}/component-execution-v1/LAYOUTS.json`, bytes: 4644868, sha256: digest(read(join(legacyDirectory, "LAYOUTS.json"))), qualification: "transport is streamed; exact-sized buffer, UTF-8 string and parsed JSON coexist; no constant-memory or RSS claim" },
  authorpack: { path: inputs.package.authorTarballLocation, bytes: pack.length, sha256: digest(pack), members: members.size, role: "authenticated planning and permitted distinct runtime fallback, never independent P01 proof" },
  planned: { readerControls: 16, admissionInvocations: 1, independentBuilds: 1, runtimeContexts: 4, runtimeAssertions: 104, types: 40 },
  scope: "EXPRPUBLICCOMPONENT", acceptedDUGate: "HELD", HTML: "accepted per latest root authorization, not rerun here", preparationProductExecutions: 0 };
const text = JSON.stringify(pin, null, 2) + "\n";
process.stdout.write(`*** Begin Patch\n*** Add File: ${owner}/component-execution-v3/PINS.json\n${text.split("\n").filter((line, index, all) => index < all.length - 1).map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
