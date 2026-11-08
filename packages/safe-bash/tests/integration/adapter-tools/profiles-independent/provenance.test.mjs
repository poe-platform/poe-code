import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, "../../../..");
const first = join(own, "evidence/first");
const audit = join(own, "evidence/audit-third");
const revision = "3bf672f722da2bdf1591ed112290b702987bf63a";
const base = "tests/integration/adapter-tools";
const json = (name, directory = first) => JSON.parse(readFileSync(join(directory, name)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = path => {
  const result = spawnSync("git", ["show", `${revision}:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const replace = (value, from, to) => {
  assert.equal(value.split(from).length, 2, from);
  return value.replace(from, to);
};
const files = directory => readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name)).sort().map(path => ({ path: relative(directory, path), sha256: hash(readFileSync(path)) }));

test("exact target and archived positive body retain original bytes; no other matrix changes", () => {
  const capture = json("capture.json");
  assert.equal(capture.revision, revision);
  assert.equal(capture.sourceTree, "782cbec72259112e0810f9d6d9d55f2e7f37992f");
  assert.equal(hash(readFileSync(join(first, "frozen-source-inputs.tar.gz"))), capture.archiveSha256);
  const original = blob(`${base}/profiles/history/matrix.test.ts.txt`).toString();
  const body = blob(`${base}/profiles/history/rmdir-body.ts.txt`);
  assert.equal(hash(body), "81ca50e611045a348db5954c53b26762da66ff4ba2c4af530349601f8d910b5e");
  let current = blob(`${base}/matrix.test.ts`).toString();
  assert.equal(current.split(body.toString()).length, 2);
  current = replace(current, 'import { withRmdirFixture } from "./profiles/rmdir-fixtures.js";\n', "");
  current = replace(current, '${backend === "webdav" ? "webdav configured atomic-empty" : backend}: create', '${backend}: create');
  current = replace(current, "await withRmdirFixture(backend,", "await withFixture(backend,");
  assert.equal(current, original);
});

test("fixture delta is exactly optional factory injection; helper and mock have zero delta", () => {
  let current = blob(`${base}/fixtures.ts`).toString();
  const reversals = [
    ['  type WebDavAtomicEmptyDirectoryBinding,\n', ""],
    ['export interface FixtureProfileOptions {\n  readonly webdavAtomicBinding?: (dav: MockDav, namespaceUrl: string) => WebDavAtomicEmptyDirectoryBinding;\n}\n\n', ""],
    ['async function davFixture(cleanups: Cleanup[], profile: FixtureProfileOptions)', 'async function davFixture(cleanups: Cleanup[])'],
    ['    ...(profile.webdavAtomicBinding ? { atomicEmptyDirectory: profile.webdavAtomicBinding(dav, baseUrl.href) } : {}),\n', ""],
    ['  profile: FixtureProfileOptions = {},\n', ""],
    ['await davFixture(cleanups, profile));', 'await davFixture(cleanups));'],
  ];
  for (const [from, to] of reversals) current = replace(current, from, to);
  assert.equal(current, blob(`${base}/profiles/history/fixtures.ts.txt`).toString());
  const before = JSON.parse(blob(`${base}/profiles/history/before.json`));
  for (const entry of before.inputs.filter(entry => !entry.path.endsWith("matrix.test.ts") && !entry.path.endsWith("fixtures.ts"))) {
    assert.equal(hash(blob(entry.path)), entry.sha256, entry.path);
  }
  assert.equal(readFileSync(join(first, "helper.diff.txt")).length, 0);
});

test("source and strict packed canonical runs register 81 distinct rows without waivers", () => {
  const source = json("source-canonical81.result.json");
  const packed = json("packed-canonical81.result.json");
  for (const record of [source, packed]) {
    assert.equal(record.status, 0);
    assert.deepEqual(record.counts, { tests: 81, pass: 81, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    assert.equal(new Set(record.names).size, 81);
    assert.equal(record.names.filter(name => name.startsWith("readonly: rejects mutation:")).length, 9);
    assert.equal(record.names.filter(name => name.startsWith("stock-webdav:")).length, 2);
    assert.equal(record.names.filter(name => name.startsWith("webdav configured atomic-empty:")).length, 1);
  }
  assert.deepEqual(source.names, packed.names);
  for (const name of ["build", "strict-source", "strict-packed", "pack"]) assert.equal(json(`${name}.result.json`).status, 0);
  const strictInputs = readFileSync(join(first, "strict-source.stdout.log"), "utf8");
  assert.ok(strictInputs.includes("profiles-independent/controls.test.ts"));
  assert.ok(strictInputs.includes("atomic-webdav-profile/atomic-mock.ts"));
  assert.equal(strictInputs.includes("history/matrix.test.ts.txt"), false);
});

test("unchanged 22 author and 27 prior controls, 14 fresh controls and three mutations are recorded", () => {
  for (const [name, count] of [["author-controls22", 22], ["prior-independent27", 27], ["new-independent14", 14], ["restored-independent14", 14]]) {
    assert.deepEqual(json(`${name}.result.json`).counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  }
  for (const [name, failures] of [["selector-lost-binding", 1], ["helper-ignores-locks", 3], ["helper-ignores-descendants", 2]]) {
    const result = json(`mutant-${name}.result.json`);
    assert.equal(result.status, 1);
    assert.deepEqual(result.counts, { tests: 14, pass: 14 - failures, fail: failures, cancelled: 0, skipped: 0, todo: 0 });
    const emitted = readFileSync(join(first, "mutants", `${name}.js.txt`));
    assert.ok(json("module-closures.json")[`mutant-${name}`].loaded.some(entry => entry.sha256 === hash(emitted)));
  }
});

test("packed product equals entire isolated build and actual runtime load hashes", () => {
  const temporary = mkdtempSync(join(own, ".provenance-"));
  try {
    const packaged = join(temporary, "pack");
    const frozen = join(temporary, "source");
    mkdirSync(packaged);
    mkdirSync(frozen);
    assert.equal(spawnSync("tar", ["-xzf", join(first, "virtual-bash-0.0.0.tgz"), "--strip-components=1", "-C", packaged]).status, 0);
    assert.equal(spawnSync("tar", ["-xzf", join(first, "frozen-source-inputs.tar.gz"), "-C", frozen]).status, 0);
    assert.equal(hash(readFileSync(join(first, "virtual-bash-0.0.0.tgz"))), json("summary.json").packSha256);
    assert.deepEqual(files(join(packaged, "dist")), json("built-manifest.json"));
    for (const entry of json("frozen-manifest.json")) {
      const bytes = readFileSync(join(frozen, entry.path));
      assert.equal(hash(bytes), entry.sha256, entry.path);
      assert.equal(hash(blob(entry.path)), entry.sha256, `committed target: ${entry.path}`);
    }
    for (const [name, closure] of Object.entries(json("module-closures.json"))) {
      const raw = readFileSync(join(first, `${name}.modules.jsonl`));
      assert.equal(hash(raw), closure.eventLogSha256);
      const events = raw.toString().trim().split("\n").map(line => JSON.parse(line));
      assert.equal(events.length, closure.events);
      for (const entry of closure.loaded) {
        if (entry.path.startsWith("outside-consumer/node_modules/virtual-bash/")) {
          assert.equal(hash(readFileSync(join(packaged, entry.path.slice("outside-consumer/node_modules/virtual-bash/".length)))), entry.sha256);
        } else if (entry.path.startsWith("source/src/")) {
          assert.equal(name, "source-canonical81");
          assert.equal(hash(readFileSync(join(frozen, entry.path.slice("source/".length)))), entry.sha256);
        } else if (entry.path.startsWith("source/dist/")) {
          assert.equal(name, "source-canonical81");
          assert.equal(hash(readFileSync(join(packaged, entry.path.slice("source/".length)))), entry.sha256);
        }
      }
    }
    assert.deepEqual(JSON.parse(readFileSync(join(packaged, "package.json"))).dependencies ?? {}, {});
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("historical source/mock and authenticated configured WsgiDAV seals are preserved separately", () => {
  for (const seal of json("historical-seals.json", audit)) {
    assert.equal(hash(blob(seal.path)), seal.sha256);
    for (const entry of seal.rows) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
  }
  const reused = json("authenticated-service-reuse.json", audit);
  assert.equal(reused.basisCommit, "b22d00c2834358dc3083de58774f3aa188093f9b");
  assert.equal(reused.newServiceRun, false);
  assert.equal(reused.newlyDownloadedBytes, 0);
  assert.deepEqual(reused.independent26, { positive: 8, guard: 17, refusal: 1, failed: 0 });
  assert.deepEqual(reused.mutationControls, { killed: 4, survived: 0, includedInNormalPassTotals: false });
  const stale = json("stale-assumptions.json", audit);
  assert.deepEqual(stale.canonicalDiff, [`${base}/fixtures.ts`, `${base}/matrix.test.ts`]);
  for (const entry of stale.stale) {
    assert.equal(hash(blob(entry.historyPath)), entry.historicalSha256);
    assert.equal(hash(blob(entry.path)), entry.candidateSha256);
    assert.notEqual(entry.candidateSha256, entry.historicalSha256);
  }
});

test("all verifier attempts are retained and only owned scratch has been removed", () => {
  for (const name of ["first", "audit-first", "audit-second", "audit-third"]) {
    const cleanup = json("cleanup.json", join(own, "evidence", name));
    assert.equal(cleanup.removed, true);
    assert.equal(existsSync(cleanup.scratch), false);
  }
  assert.deepEqual(json("preservation.json").changedProtected, []);
  for (const name of ["verify.mjs", "controls.test.ts"]) assert.deepEqual(readFileSync(join(own, name)), readFileSync(join(first, "verifier-inputs", `${name}.txt`)));
});
