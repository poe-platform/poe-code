import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedSpawn } from "../process.ts";

const root = process.cwd();
const owned = "tests/shell-stress/canonical-profile-migration";
const phase = process.argv[2];
assert.ok(["A", "B", "C", "FINAL"].includes(phase));
const attempt = process.argv[3];
assert.ok(attempt === undefined || (phase === "A" && attempt === "execution"));
const output = `${owned}/candidate-${phase}${attempt ? `-${attempt}` : ""}.json`;
assert.equal(existsSync(output), false, "No overwrite/retry for green");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024 });
const preparation = JSON.parse(readFileSync(`${owned}/inputs.json`));
const immutable = ["README.md", "prepare.mjs", "product-cohort.mjs", "analyze.mjs", "inputs.json", "native.json", "product.json", "comparison.json", "proposal.json", "historical-fullgate-native.json", "seal.json"];
for (const name of immutable) assert.deepEqual(readFileSync(`${owned}/${name}`), git("show", `ab02ed8:${owned}/${name}`));
const authorized = ["tests/shell/invocation-discovery-fixes.test.ts", "tests/shell-stress/differential.test.ts", "tests/shell-stress/current-gaps/compatibility.test.ts", "tests/shell-stress/invocation-closure/holdout.test.ts"];
for (const [path, original] of Object.entries(preparation.originals)) if (!authorized.includes(path)) assert.equal(hash(readFileSync(path)), original.sha256, `Immutable helper changed: ${path}`);
const archive = mkdtempSync(resolve(owned, `.candidate-${phase}-`));
const tar = git("archive", "--format=tar", preparation.sourceCommit, "--", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json");
execFileSync("/usr/bin/tar", ["-xf", "-", "-C", archive], { input: tar, timeout: 10000 });
for (const [path, original] of Object.entries(preparation.source)) {
  const bytes = readFileSync(resolve(archive, path));
  assert.equal(hash(bytes), original.sha256, path);
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), original.blob, path);
}
const additions = readdirSync(owned).filter(name => /^(?:discovery-profile|historical-discovery|primary-reference|primary-fixtures|reference-integrity|candidate-trace|candidate-typecheck)\.(?:ts|mjs|json)$/u.test(name)).map(name => `${owned}/${name}`);
const copied = [...Object.keys(preparation.originals), ...immutable.map(name => `${owned}/${name}`), ...additions];
for (const path of copied) {
  mkdirSync(dirname(resolve(archive, path)), { recursive: true });
  copyFileSync(path, resolve(archive, path));
}
symlinkSync(resolve(root, "node_modules"), resolve(archive, "node_modules"), "dir");
function tree(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap(name => {
    const full = resolve(directory, name);
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(full);
    return stat.isSymbolicLink() ? [[path, `symlink:${readlinkSync(full)}`]] : stat.isDirectory() ? tree(full, path) : [[path, hash(readFileSync(full))]];
  });
}
const before = Object.fromEntries(tree(archive));
const devtoolsBefore = Object.fromEntries(tree(resolve(root, "node_modules")));
const evidence = { phase, startedAt: new Date().toISOString(), sourceCommit: preparation.sourceCommit, archive, archiveTarSha256: hash(tar), preparationCommit: "ab02ed86ad637e2319a7734cc53904d41eed97d1", independentFreeze: "a48b1e9dc8bcada35d1818ee569c3e74d90b9980", headBefore: git("rev-parse", "HEAD").toString().trim(), node: { executable: process.execPath, version: process.version }, copied, before, devtoolsBefore, runs: [] };
const loader = pathToFileURL(resolve(archive, `${owned}/candidate-trace.mjs`)).href;
async function run(label, args, timeout) {
  const trace = resolve(archive, `.candidate-trace-${label}.jsonl`);
  const env = { ...process.env, NODE_OPTIONS: `--import=${loader}`, CANONICAL_PROFILE_TRACE: trace };
  delete env.INVOCATION_TRACE;
  delete env.CLOSURE_OBSERVATIONS;
  delete env.NODE_PATH;
  const result = await isolatedSpawn(process.execPath, args, { cwd: archive, env, timeout, maxBuffer: 4 * 1024 * 1024 });
  const imports = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  if (existsSync(trace)) unlinkSync(trace);
  const stdout = result.stdout.toString();
  return { label, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout, stderr: result.stderr.toString(), imports, counts: Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])) };
}
const paths = phase === "A" ? [authorized[0], `${owned}/historical-discovery.ts`] : phase === "B" ? authorized.slice(1, 3) : phase === "C" ? [authorized[3]] : authorized;
for (const [index, path] of paths.entries()) {
  const result = await run(`tests-${index}`, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", path], 90000);
  evidence.runs.push({ path, ...result });
  if (result.status !== 0 && !path.endsWith("historical-discovery.ts")) break;
}
if ((phase === "B" || phase === "FINAL") && evidence.runs.every(run => run.status === 0)) evidence.integrity = await run("integrity", ["--import", "tsx", `${owned}/reference-integrity.mjs`], 10000);
if (phase === "C" && evidence.runs.every(run => run.status === 0)) evidence.typecheck = await run("typecheck", [`${owned}/candidate-typecheck.mjs`], 30000);
const after = Object.fromEntries(tree(archive));
const records = [...evidence.runs, ...(evidence.integrity ? [evidence.integrity] : []), ...(evidence.typecheck ? [evidence.typecheck] : [])].flatMap(run => run.imports);
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
const mismatches = records.filter(record => !record.path.startsWith(archive + "/") || before[relative(archive, record.path)] !== record.hash || after[relative(archive, record.path)] !== record.hash);
const productMismatches = records.filter(record => record.path.startsWith(resolve(archive, "src") + "/") && preparation.source[relative(archive, record.path)]?.sha256 !== record.hash);
const devtoolsUnchanged = JSON.stringify(devtoolsBefore) === JSON.stringify(Object.fromEntries(tree(resolve(root, "node_modules"))));
evidence.after = after;
evidence.guard = { changed, mismatches, productMismatches, actualLoads: records.length, rootIndexLoads: records.filter(record => record.path === resolve(archive, "src/index.ts")).length, devtoolsUnchanged, valid: records.length > 0 && changed.length === 0 && mismatches.length === 0 && productMismatches.length === 0 && devtoolsUnchanged, tracing: "Owned preload forwards only import-trace environment to Node children whose legacy helpers scrub env; no shell wrapper/source/argv transformation or virtual env change. Full original imports remain; natural root-index traversal is recorded, not forced." };
evidence.finishedAt = new Date().toISOString();
const patch = `*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(evidence, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
execFileSync("apply_patch", [], { input: patch, maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ phase, runs: evidence.runs.map(({ path, status, counts }) => ({ path, status, counts })), integrity: evidence.integrity?.status, typecheck: evidence.typecheck?.status, guard: evidence.guard }, null, 2));
assert.equal(evidence.guard.valid, true, "Import/source drift: stop without retry");
assert.equal(evidence.runs.length, paths.length);
for (const result of evidence.runs) {
  if (result.path.endsWith("historical-discovery.ts")) {
    assert.equal(result.status, 1);
    assert.deepEqual(result.counts, { tests: 52, pass: 36, fail: 16, cancelled: 0, skipped: 0, todo: 0 });
  } else assert.equal(result.status, 0, "Unexpected functional failure: stop without retry");
}
