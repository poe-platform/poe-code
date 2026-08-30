import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { directory, repository, owner, legacyDirectory, read, json, digest, objectHash } from "./common.mjs";
import { casesPath, casesSha256, frozenCases } from "./fixture.mjs";
import { aggregateControls, packageIds, typeIds, contextIds, repairControlCount } from "./verdict.mjs";
import { gitExecutable, environment } from "../component-execution-v3/stream-reader.mjs";

const previous = join(repository, owner, "component-execution-v3");
const basePins = json(join(previous, "PINS.json"));
for (const tool of basePins.tools) assert.equal(digest(read(tool.path)), tool.sha256);
assert.equal(process.execPath, basePins.tools[1].path);
const git = (...args) => execFileSync(gitExecutable, ["--no-replace-objects", "--literal-pathspecs", ...args], { cwd: repository, env: environment, maxBuffer: 131072 });
const history = [];
for (const [commit, subtree] of [
  ["4a091ba091413a6466034a8d1f9b84033517f913", "component-execution-v1"],
  ["e87d3f16d9688d2449050ebc66f50ac93eb9c17b", "component-execution-v2"],
  ["d3136122f2d1d47f0d0db82d71a4f50593359446", "component-execution-v3"],
  ["d3136122f2d1d47f0d0db82d71a4f50593359446", "component-execution-v3-blocker"],
]) {
  const prefix = `${owner}/${subtree}`;
  const entries = git("ls-tree", "-rlz", commit, "--", prefix).toString().split("\0").filter(Boolean).map(line => {
    const [attributes, path] = line.split("\t"), [mode, type, objectId, length] = attributes.trim().split(/\s+/u);
    assert.equal(mode, "100644"); assert.equal(type, "blob"); assert.ok(!path.split("/").includes("AGENTS.md"));
    const bytes = read(join(repository, path)); assert.equal(bytes.length, Number(length)); assert.equal(objectHash(bytes), objectId); assert.equal(lstatSync(join(repository, path)).mode & 0o777, 0o644);
    return { commit, path, mode, type, objectId, bytes: bytes.length, sha256: digest(bytes) };
  });
  history.push({ commit, prefix, entries });
}
frozenCases();
const inputs = json(join(legacyDirectory, "INPUTS.json"));
const pack = read(inputs.package.authorTarballLocation);
assert.equal(pack.length, 727526); assert.equal(digest(pack), "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd");
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
const layoutBytes = read(join(legacyDirectory, "LAYOUTS.json"));
assert.equal(layoutBytes.length, 4644868); assert.equal(digest(layoutBytes), basePins.retainedJSON.sha256);
const layouts = JSON.parse(layoutBytes), remap = value => value.replaceAll(legacyDirectory, directory);
const layoutDeltas = layouts.layouts.map(layout => {
  const expected = Object.fromEntries(Object.entries(layout.expected).map(([path, sha256]) => [remap(path), sha256]));
  let poisonEntrypointSha256;
  if (layout.forbiddenSource) {
    poisonEntrypointSha256 = digest(members.get("dist/index.js").toString() + `\nimport ${JSON.stringify(remap(layout.forbiddenSource))};\n`);
    expected[join(remap(layout.consumer), "node_modules/virtual-bash/dist/index.js")] = poisonEntrypointSha256;
  }
  return { name: layout.name, expectedSha256: digest(JSON.stringify(expected)), poisonEntrypointSha256 };
});
const permissionControls = inputs.runtimes.flatMap(runtime => ["permission", "wrong-binding", "absent-directory", "positive-emission"].map(id => `${runtime.version.startsWith("v22") ? "node22" : "node24"}-${id}`));
const controls = [...permissionControls, ...["positive", "missing", "hash-mismatch"].map(id => `cases-${id}`), ...aggregateControls.map(id => `aggregate-${id}`)];
assert.equal(controls.length, repairControlCount);
const pins = { schema: "expr-minimal-repair-v4-pins/1", authorizationDate: "2026-08-28", priorRecipeV3: "56f550afee7e6fd895b6d700e4cec376b6cf1eaf", priorEvidence: "d3136122f2d1d47f0d0db82d71a4f50593359446",
  basePins: { path: `${owner}/component-execution-v3/PINS.json`, sha256: digest(read(join(previous, "PINS.json"))) }, history,
  reader: { path: `${owner}/component-execution-v3/stream-reader.mjs`, sha256: digest(read(join(previous, "stream-reader.mjs"))), previousControls: 16, newControls: 0, semanticsChanged: false },
  cases: { path: casesPath, sha256: casesSha256, bytes: read(casesPath).length, regenerated: false },
  layoutDeltas, controls, counts: { newRepairControls: controls.length, permissions: permissionControls.length, fixtureControls: 3, aggregateControls: aggregateControls.length, contexts: contextIds.length, packageControls: contextIds.length * packageIds.length, runtimeAssertions: 104, types: contextIds.length * typeIds.length },
  emission: { path: join(directory, "work/run-001/build/dist"), beforeLaunch: "exclusive mkdir 0755; empty; exact-directory allowlist", compilerOutDirUnchanged: "dist", compilerRootDirUnchanged: "src", broaderWriteGrant: false },
  diagnosis: { evidence: "sealed v3 raw P01-build.json and CHECKPOINT.json", compilerStatus: 2, TS5033: 832, pathMatchesConfig: true, noPrecreatedDistInV3: true, absentDirectoryAllowlistCause: "to be independently qualified by two negative compiler controls", missingCases: "bind() resolved v3/cases.json instead of unchanged v1/cases.json", falseOuterZero: "run.mjs caught failures but never assigned aggregate exit status" },
  preparationProductExecutions: 0, preparationControlExecutions: 0, scope: "EXPRPUBLICCOMPONENT only; accepted-DU HELD; HTML not rerun" };
const content = JSON.stringify(pins, null, 2) + "\n";
process.stdout.write(`*** Begin Patch\n*** Add File: ${owner}/component-execution-v4/PINS.json\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
