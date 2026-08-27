import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, "../../../..");
const output = process.argv[2];
assert(output?.startsWith("/tmp/safe-bash-getopts-runtime."));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const baseline = JSON.parse(readFileSync(join(own, "baseline.json")));
const run = JSON.parse(readFileSync(join(output, "RUN.json")));
const integrity = JSON.parse(readFileSync(join(output, "INTEGRITY.json")));
const supplemental = JSON.parse(readFileSync(join(output, "SUPPLEMENTAL-resolved.json")));
const git = (...args) => execFileSync("git", args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 32 * 1024 * 1024 }).toString();
function inventory(directory, ignored = new Set()) {
  const entries = {};
  for (const name of readdirSync(directory).sort()) {
    if (ignored.has(name)) continue;
    const path = join(directory, name), stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) {
      entries[name + "/"] = "directory";
      for (const [child, digest] of Object.entries(inventory(path))) entries[name + "/" + child] = digest;
    } else { assert(stat.isFile(), path); entries[name] = hash(readFileSync(path)); }
  }
  return entries;
}
assert.deepEqual(inventory(join(output, "archive"), new Set(["dist", "node_modules"])), run.inputs);
assert.deepEqual(inventory(join(output, "archive/dist")), integrity.built);
assert.deepEqual(inventory(join(output, "consumer/node_modules/virtual-bash")), integrity.moved);
assert.deepEqual(inventory(join(output, "holdout-consumer-resolved/node_modules/virtual-bash")), integrity.moved);
const protectedAfter = {};
for (const [path, digest] of Object.entries(baseline.protectedPaths)) {
  protectedAfter[path] = hash(readFileSync(join(repo, path)));
  assert.equal(protectedAfter[path], digest, path);
}
const sourceAfter = {};
for (const path of Object.keys(baseline.bindings)) {
  const bytes = readFileSync(join(repo, path));
  assert.deepEqual(bytes, execFileSync("git", ["show", run.candidate + ":" + path], { cwd: repo }));
  sourceAfter[path] = hash(bytes);
}
const retention = [];
let source;
for (const line of baseline.ownedOutputBaselinePatch.split("\n")) {
  if (line.startsWith("+++ b/")) source = line.slice(6);
  else if (line.startsWith("+") && !line.startsWith("+++")) {
    const value = line.slice(1);
    const retained = readFileSync(join(repo, source), "utf8").includes(value);
    assert(retained, source + ": " + value);
    retention.push({ source, value, retained });
  }
}
const files = {};
function capture(relative) {
  const bytes = readFileSync(join(output, relative));
  files[relative] = { bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString("base64") };
}
for (const name of readdirSync(output).sort()) {
  if (/\.(json|tap|txt)$/u.test(name) && lstatSync(join(output, name)).isFile()) capture(name);
}
for (const name of readdirSync(join(output, "logs")).sort()) capture("logs/" + name);
const safejs = [];
for (const attempt of ["safejs-replay", "safejs-replay-v2"]) {
  for (const name of readdirSync(join(output, attempt)).sort()) {
    if (/\.(json|stdout|stderr)$/u.test(name)) capture(attempt + "/" + name);
    if (!name.startsWith("cohort-")) continue;
    const reportPath = attempt + "/" + name + "/evidence/report.json";
    const report = JSON.parse(readFileSync(join(output, reportPath)));
    safejs.push({ attempt, family: report.family, status: report.status, counts: report.counts, privateBeforeAfter: report.privateBeforeAfter, liveChildren: report.knownLiveChildren });
    assert.deepEqual(report.knownLiveChildren, []);
    for (const category of ["evidence", "logs"]) {
      const root = attempt + "/" + name + "/" + category;
      for (const path of Object.keys(inventory(join(output, root)))) if (!path.endsWith("/")) capture(root + "/" + path);
    }
  }
  for (const path of Object.keys(inventory(join(output, attempt))).filter(path => /^(harness|profiles|execution-v1|safejs-execution-v1)\//u.test(path) && !path.endsWith("/"))) capture(attempt + "/" + path);
}
const publicOutput = readFileSync(join(output, "logs/moved-public-runtime.stdout"), "utf8");
const publicStart = publicOutput.indexOf("# {\n"), publicEnd = publicOutput.indexOf("# Subtest:", publicStart);
const moved = JSON.parse(publicOutput.slice(publicStart, publicEnd).replace(/^# ?/gmu, ""));
assert.equal(moved.rows.length, 9);
assert(moved.rows.every(row => row.status === "PASS"));
const preservation = { sealedAt: new Date().toISOString(), qualification: "AUTHOR_EXACT_COMMITTED_CANDIDATE_SELECTED_COHORTS_NOT_INDEPENDENT_ACCEPTANCE", candidate: run.candidate, candidateTree: git("rev-parse", run.candidate + "^{tree}").trim(), currentHead: git("rev-parse", "HEAD").trim(), platform: { platform: platform(), arch: arch(), release: release() }, sourceBefore: baseline.bindings, sourceAfter, helperUnchanged: sourceAfter["src/shell/getopts.ts"] === baseline.bindings["src/shell/getopts.ts"], protectedAfter, protectedOriginalPathsUnchanged: true, protectedPathsQualification: "243 original protected filenames checked; not an append-proof live repository tree claim", archiveIncludingNewEntriesUnchanged: true, generatedExclusions: ["archive/dist (separately compared)", "archive/node_modules (explicit installed-tool symlink)"], ownedOutputAdditionsRetained: retention, ownedOutputQualification: "26/26 accepted added lines still occur verbatim; combined with 42/36/core/state/public/SafeJS regression checks, not an equivalence proof", currentOwnedDiff: git("diff", run.candidate, "--", "src/shell/runtime.ts", "src/shell/shell.ts", "src/shell/getopts.ts"), foreignIndexAtSeal: git("diff", "--cached", "--name-status"), currentStatusAtSeal: git("status", "--short"), ownSourceOnlyCandidateDiff: git("diff-tree", "--no-commit-id", "--name-only", "-r", run.candidate), sharedDist: "No build command targeted shared dist; no full before/after shared-dist inventory was captured", runtime: run.rows.find(row => row.label === "runtime").counts, core: supplemental.core.counts, state: run.rows.find(row => row.label === "legacy-state-final").counts, authorOwnedOutput: run.rows.find(row => row.label === "focused-final-02").counts, authorReplayIndependentHoldouts: { intended: supplemental.rows.length, passed: supplemental.rows.filter(row => row.status === 0 && row.observation.status === "PASS").length }, movedPublic: { nodeTestFiles: 1, actualProfiles: moved.rows }, safejs, children: "All recorded test/supervisor children settled; all actual SafeJS child records closed; no native Bash children launched in Stage2", frozenNativeQualification: "Original16 scripts14 original5.3 expectations matched; preserved N05/N13 corrections; runtime reuses10 nonfailure stdout facts, separately tests correctedN05 and deliberateN04/readonly profiles. Not native parity. Phase1 original124 invocations are not helper/runtime passes." };
const raw = Buffer.from(JSON.stringify({ schema: 1, candidate: run.candidate, files }) + "\n");
const compressed = gzipSync(raw, { level: 9 });
const manifest = { schema: 1, classification: "captured-data-not-canonical-TypeScript", candidate: run.candidate, rawSHA256: hash(raw), compressedSHA256: hash(compressed), rawBytes: raw.length, files: Object.fromEntries(Object.entries(files).map(([path, { bytes, sha256 }]) => [path, { bytes, sha256 }])) };
const artifacts = { "PRESERVATION.json": JSON.stringify(preservation, null, 2) + "\n", "MANIFEST.json": JSON.stringify(manifest, null, 2) + "\n", "RAW.json.gz.base64": compressed.toString("base64") + "\n" };
for (const [name, text] of Object.entries(artifacts)) {
  const path = "tests/shell/getopts/runtime/evidence-v1/" + name;
  execFileSync("apply_patch", [], { cwd: repo, input: "*** Begin Patch\n*** Add File: " + path + "\n" + text.split("\n").slice(0, -1).map(line => "+" + line).join("\n") + "\n*** End Patch\n", maxBuffer: 1024 * 1024 });
}
console.log(JSON.stringify({ files: Object.keys(files).length, rawBytes: raw.length, compressedBytes: compressed.length, candidate: run.candidate, protected: Object.keys(protectedAfter).length, retention: retention.length, safejs }, null, 2));
