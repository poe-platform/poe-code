import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const expected = {
  "baseline.data.json.gz": "cfdc64a565c516836c4b7dfc7b25c802fb6a91b3321b3343bf4c24723fbf6b36",
  "baseline-v2.data.json.gz": "b0c351e37ae57b55784dc8a69ac11172e444d220267aa9b73669874158b6ed0a",
  "source-inputs.tar.gz": "eae80806da8d18e5213c13c075a4815da0b740415386d86ccc9beeafb8402b45",
};
for (const [name, digest] of Object.entries(expected)) assert.equal(hash(readFileSync(path.join(own, name))), digest, name);
const seals = ["FREEZE.json", "FREEZE-v2.json"].map(name => JSON.parse(readFileSync(path.join(own, name), "utf8")));
const captures = ["baseline.data.json.gz", "baseline-v2.data.json.gz"].map(name => JSON.parse(gunzipSync(readFileSync(path.join(own, name)))));
const failures = [];
for (const [index, capture] of captures.entries()) {
  const seal = seals[index];
  assert.deepEqual(capture.seal, seal);
  assert.equal(capture.failure, undefined);
  assert.equal(capture.temporaryRemoved, true);
  assert.equal(seal.revision, "12e196af8d8b0866339747150b02ca00b9764a09");
  assert.equal(seal.acceptedHelper, "fbbe1ef793b7434871403125efbeb46624a8e081");
  for (const [name, bytes] of Object.entries(capture.fixtures)) {
    assert.equal(hash(Buffer.from(bytes, "base64")), seal.fixtureHashes[name]);
    if (index === 1) assert.equal(hash(readFileSync(path.join(own, name))), seal.fixtureHashes[name], name);
  }
  const runtime = capture.records[0];
  assert.equal(runtime.status, 1);
  assert.equal(runtime.signal, null);
  assert.match(runtime.stdout, /# tests 26\n/);
  assert.match(runtime.stdout, new RegExp(`# pass ${index === 0 ? 13 : 14}\\n`));
  assert.match(runtime.stdout, new RegExp(`# fail ${index === 0 ? 13 : 12}\\n`));
  for (const key of ["cancelled", "skipped", "todo"]) assert.match(runtime.stdout, new RegExp(`# ${key} 0\\n`));
  failures.push([...runtime.stdout.matchAll(/^not ok \d+ - (R\d+)/gm)].map(match => match[1]));
  assert.equal(capture.records.length, 7);
  for (const type of capture.records.slice(1)) {
    assert.equal(type.status, 2, type.label);
    assert.equal(type.signal, null);
    assert.match(type.stdout, /(?:TS2353|TS2339)/);
    assert.match(type.stdout, /signal.*(?:does not exist|may only specify)|(?:may only specify|does not exist).*signal/);
    assert.equal([...type.stdout.matchAll(/error (TS\d+)/g)].some(match => !["TS2353", "TS2339"].includes(match[1])), false);
  }
  for (const entry of capture.loadedModules) {
    const offset = entry.name.indexOf("/snapshot/src/");
    if (offset < 0) continue;
    const name = entry.name.slice(offset + "/snapshot/".length);
    assert.equal(entry.sha256, seal.sourceHashes[name], name);
  }
}
assert.deepEqual(failures[0].filter(id => !failures[1].includes(id)), ["R25"]);
assert.deepEqual(failures[1], ["R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R12", "R14", "R22"]);
assert.deepEqual(seals[0].sourceHashes, seals[1].sourceHashes);
const seal = seals[1];
const names = Object.keys(seal.sourceHashes);
assert.equal(names.some(name => path.basename(name) === "AGENTS.md"), false);
assert.equal(hash(git("archive", "--format=tar.gz", seal.revision, ...names)), seal.sourceArchiveSha256);
for (const [name, digest] of Object.entries(seal.sourceHashes)) assert.equal(hash(git("show", `${seal.revision}:${name}`)), digest, name);
const loaded = new Set(captures[1].loadedModules.filter(entry => entry.name.includes("/snapshot/src/")).map(entry => entry.name));
console.log(JSON.stringify({ revision: seal.revision, timing: seal.timing, families: seal.families,
  sourceFiles: names.length, authenticatedLoadedProductFiles: loaded.size,
  originalRuntime: "13 pass / 13 fail", correctedRuntime: "14 pass / 12 expected pre-integration failures",
  correctedTypeFamilies: "6 missing-signal failures; no unrelated diagnostics", originalR25Retained: true,
  mutationClasses: "10 frozen, not executed", temporaryRootsRemoved: true }, null, 2));
