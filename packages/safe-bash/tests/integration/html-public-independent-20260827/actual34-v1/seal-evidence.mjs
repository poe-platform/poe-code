import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { candidate, fileHash, frozen, git, here, inventory, json, packSha, parse, repository, sha256 } from "./common.mjs";

const result = parse(join(here, "execution-01/RESULT.json"));
const qualification = parse(join(here, "qualification-01/RESULT.json"));
const pin = parse(join(here, "PREAUTH.json"));
assert.equal(result.status, "FROZEN_ASSERTIONS_PASSED_WITH_ORIGINAL_UNSCORED_LIMITS");
assert.equal(result.recipeCommit, "7885ce6a043653eeacbf4dd885f1c59ee570b5a7");
assert.deepEqual(result.counts, { runtimeExecuted: 68, runtimePassed: 68, runtimeFailed: 0, runtimeUnexecuted: 0, typesExecuted: 10, typesExpected: 10, controlClassesExecuted: 10, controlClassesExpected: 10 });
assert.equal(result.unexpected.length, 0); assert.equal(result.invocation, 1); assert.equal(result.retries, 0);
assert.equal(qualification.status, "HARNESS_ONLY_4_EXPECTED");
const protectedFiles = [];
for (const [path, row] of Object.entries(pin.protectedFiles)) { assert.equal(fileHash(join(repository, path)), row.sha256, path); protectedFiles.push(path); }
const manifest = parse(join(here, "MANIFEST.json"));
for (const [path, hash] of Object.entries(manifest.files)) { assert.equal(fileHash(join(here, path)), hash); assert.equal(sha256(git(["show", `${result.recipeCommit}:${relative(repository, join(here, path))}`])), hash); }
const originalDelta = git(["diff", "--name-only", pin.freeze, "--", ...pin.fixturePaths]).toString();
assert.equal(originalDelta, "");
const rawCommands = [];
for (const command of result.commands) {
  const path = join(here, "execution-01", command.raw), raw = parse(path);
  assert.equal(raw.code, command.code); assert.equal(raw.closed, true); assert.equal(raw.signal, null);
  assert.equal(raw.error, undefined); assert.equal(raw.stopReason, undefined); assert.equal(raw.signals.length, 0);
  assert.deepEqual(raw.ps.members, []); assert.equal(raw.ps.status, 0);
  for (const name of ["stdout", "stderr"]) {
    const filename = path.replace(/RAW\.json$/u, `${name}.data`), bytes = readFileSync(filename);
    assert.equal(fileHash(filename), raw[`${name}Sha256`]); assert.equal(bytes.length, raw[`${name}Bytes`]); assert.equal(bytes.toString(), raw[name]);
  }
  rawCommands.push({ name: command.name, pid: raw.pid, code: raw.code, closed: true, signals: [] });
}
assert.equal(rawCommands.length, 88);
const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 ** 2 });
assert.equal(ps.status, 0); assert.equal(ps.error, undefined); assert.equal(ps.signal, null);
const processes = ps.stdout.trim().split("\n").map(line => { const fields = line.trim().split(/\s+/u); return { pid: Number(fields[0]), pgid: Number(fields[2]) }; });
for (const row of rawCommands) assert.ok(!processes.some(process => process.pid === row.pid || process.pgid === row.pid));
const work = join(here, "node_modules/actual34-work"), moved = join(work, "physically-moved-consumer");
assert.equal(existsSync(join(work, "installed")), false);
assert.deepEqual(inventory(join(moved, "node_modules/virtual-bash")), pin.package.memberHashes);
assert.equal(fileHash(join(work, "package.tgz")), packSha);
const allLoads = result.runtime.flatMap(row => row.loads), productLoads = allLoads.filter(row => row.path.startsWith("node_modules/virtual-bash/"));
const unique = {};
for (const load of productLoads) {
  const path = load.path.slice("node_modules/virtual-bash/".length);
  assert.equal(load.sha256, pin.package.memberHashes[path], path);
  unique[path] ??= { sha256: load.sha256, bytes: load.bytes, observedLoads: 0 };
  unique[path].observedLoads++;
}
const p01 = result.runtime.filter(row => row.id === "P01").map(row => ({ layout: row.layout, raw: row.raw, status: row.status, loads: row.loads.filter(load => ["node_modules/virtual-bash/dist/index.js", "node_modules/virtual-bash/dist/commands/html-to-markdown/index.js"].includes(load.path)) }));
assert.equal(p01.length, 2); assert.ok(p01.every(row => row.loads.length === 2));
json(join(here, "LOAD-PROOF.json"), { candidate, packSha256: packSha, originalFixtureCommit: pin.freeze, actualRuntimeModuleLoads: allLoads.length, actualProductModuleLoads: productLoads.length, uniqueProductModules: Object.keys(unique).length, modules: unique, p01, scope: "Exact nextLoad-returned bytes of main-thread consumer/product modules; not worker-nextLoad tracing. Regex worker construction/hash is separately frozen and exercised by P12/C05." });
const scopes = result.runtime.map(row => ({ layout: row.layout, id: row.id, status: row.status, code: row.code, raw: row.raw, ...(row.receipt.details ? { details: row.receipt.details } : {}) }));
json(join(here, "SUMMARY.json"), { schema: "html-actual34-summary/1", candidate, freeze: pin.freeze, recipeCommit: result.recipeCommit, recipeManifestSha256: result.manifestSha256, status: result.status, started: result.started, finished: result.finished, invocation: 1, retries: 0, counts: result.counts, node: pin.tools.node, runtime: scopes, types: result.types.map(row => ({ layout: row.layout, filename: row.filename, status: row.status, code: row.code, raw: row.raw, resolvedDeclarations: Object.keys(row.resolutions).length })), controls: result.controls, package: { sha256: packSha, bytes: 717103, members: 830, distMembers: 828, physicallyMoved: true, originalInstalledPathAbsent: true }, productLoads: productLoads.length, uniqueProductModules: Object.keys(unique).length, commands: rawCommands, unexecuted: [], sourceBugsEstablished: [], qualificationOnly: qualification.rows, limits: ["Frozen direct-close identity/disposition observations remain unscored, not new assertions.", "Node22 only; no Node24 denominator.", "Composed admission does not rescore old v2/v3/v3.1 cohorts.", "No fullgate, whole76 acceptance, DU29 release or execution, expr104, title support or superiority claim."] });
json(join(here, "FINAL-AUTH.json"), { at: new Date().toISOString(), protectedFiles, original18GitDiff: originalDelta, originalFixtureCommit: pin.freeze, protectedCount: protectedFiles.length, status: "unchanged", tools: pin.tools, newEntryScope: "Actual complete consumer/package file inventories detect additions/deletions/content and symlink changes; empty directories not covered. Protected historical paths do not claim append-proof foreign-owned directories." });
json(join(here, "CLEANUP.json"), { at: new Date().toISOString(), actualChildren: rawCommands.length, allClosedNaturally: true, actualSignals: 0, remainingRecordedPidsOrGroups: [], qualificationIntentionalKill: qualification.rows.find(row => row.name === "deadline"), coordinatorExit: 0, coordinatorExitEvidence: "LAUNCH-RECEIPT.json: observed external tool exit; coordinator PID not captured" });
const raw = [], directories = [];
function walk(directory, prefix) {
  directories.push(prefix);
  for (const name of readdirSync(directory).sort()) {
    const absolute = join(directory, name), path = `${prefix}/${name}`, stat = lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) walk(absolute, path);
    else { assert.ok(stat.isFile()); raw.push({ path, absolute, bytes: stat.size, sha256: fileHash(absolute) }); }
  }
}
walk(join(here, "execution-01"), "execution-01"); walk(join(here, "qualification-01"), "qualification-01");
raw.push({ path: "installed-input/package.tgz", absolute: join(work, "package.tgz"), bytes: 717103, sha256: packSha });
directories.push("installed-input");
json(join(here, "RAW-INVENTORY.json"), { directories, files: raw.map(({ absolute, ...row }) => row), bytes: raw.reduce((total, row) => total + row.bytes, 0), format: "gzip of one JSON object per regular file: path,bytes,sha256,base64; exact bytes, no source transformation" });
const archive = join(here, "captures.jsonl.gz"), gzip = createGzip({ level: 9 });
const completion = pipeline(gzip, createWriteStream(archive, { flags: "wx" }));
for (const row of raw) {
  const bytes = readFileSync(row.absolute); assert.equal(sha256(bytes), row.sha256);
  const line = `${JSON.stringify({ path: row.path, bytes: row.bytes, sha256: row.sha256, base64: bytes.toString("base64") })}\n`;
  if (!gzip.write(line)) await once(gzip, "drain");
}
gzip.end(); await completion;
const expected = new Map(raw.map(row => [row.path, row]));
const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
let decodedBytes = 0;
for await (const line of lines) {
  const row = JSON.parse(line), original = expected.get(row.path); assert.ok(original, row.path);
  const bytes = Buffer.from(row.base64, "base64"); assert.equal(bytes.length, original.bytes); assert.equal(sha256(bytes), original.sha256);
  assert.equal(row.bytes, original.bytes); assert.equal(row.sha256, original.sha256); decodedBytes += bytes.length; expected.delete(row.path);
}
assert.equal(expected.size, 0);
assert.equal(decodedBytes, raw.reduce((total, row) => total + row.bytes, 0));
const workFiles = inventory(join(here, "node_modules"));
json(join(here, "WORK-INVENTORY.json"), { files: workFiles, sha256: sha256(JSON.stringify(workFiles)), scope: "Final staging inventory only, not executable/source fallback admission. Package and consumer PRE/POST are in raw capture." });
for (const row of raw) {
  if (row.path === "execution-01/INVOCATION.json" || row.path === "qualification-01/RESULT.json" || row.path === "installed-input/package.tgz") continue;
  rmSync(row.absolute);
}
for (const path of [...directories].sort((left, right) => right.length - left.length)) {
  if (["execution-01", "qualification-01", "installed-input"].includes(path)) continue;
  rmSync(join(here, path), { recursive: true });
}
rmSync(join(here, "node_modules"), { recursive: true });
json(join(here, "COMPACTION.json"), { at: new Date().toISOString(), archive: "captures.jsonl.gz", archiveSha256: fileHash(archive), compressedBytes: lstatSync(archive).size, regularFiles: raw.length, decodedBytes, allDecodedFilesHashVerified: true, stagedWorkRemoved: true, originalRawDirectoryLocksRetained: ["execution-01/INVOCATION.json", "qualification-01/RESULT.json"], productRerun: false });
console.log(JSON.stringify({ status: result.status, counts: result.counts, actualProductLoads: productLoads.length, actualChildren: rawCommands.length, capturedFiles: raw.length, archiveSha256: fileHash(archive), protectedFiles: protectedFiles.length }));
