import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = join(repository, "tests/integration/qualified-current-release-review");
const evidence = join(owner, "execution-evidence");
const report = JSON.parse(readFileSync(join(evidence, "positive/result.json")));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("/usr/bin/git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const readAt = (revision, path) => git("show", `${revision}:${path}`);
const checks = [];
const check = (name, operation) => { operation(); checks.push({ name, passed: true }); };
const readJson = name => JSON.parse(readFileSync(join(evidence, name)));
check("full current source, test and helper manifests match immutable Git bytes", () => {
  for (const entry of [...report.sources, ...report.tests, ...report.harness]) {
    assert.equal(digest(readAt(report.sourceCommit, entry.path)), entry.sha256, entry.path);
    assert.equal(digest(readFileSync(join(report.root, entry.path))), entry.sha256, entry.path);
  }
  assert.equal(digest(JSON.stringify(report.sources)), report.sourceTreeSha256);
  assert.equal(digest(JSON.stringify(report.tests)), report.testTreeSha256);
  assert.equal(digest(JSON.stringify(report.harness)), report.harnessSha256);
});
check("frozen preparation/input artifacts unchanged", () => {
  for (const name of ["FREEZE.md", "inputs.json", "prepare-freeze.mjs"]) assert.equal(digest(readFileSync(join(owner, name))), digest(readAt("45041534d1c1ead57f8057ac6b33b3b981307ce6", `tests/integration/qualified-current-release-review/${name}`)));
  for (const name of ["audit.mjs", "preparation-audit.json"]) assert.equal(digest(readFileSync(join(owner, name))), digest(readAt("bc03e68", `tests/integration/qualified-current-release-review/${name}`)));
});
const archivePaths = ["tests/commands/archive/native.test.ts", "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/pax-independent/controls.test.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts"];
const archiveBindings = archivePaths.map(path => ({ path, candidateSha256: digest(readAt(report.sourceCommit, path)), historicalE36Sha256: digest(readAt("e36dab2b6abc216ddc89e5786a0eba76f08a1722", path)) }));
check("original archive inputs and hardcoded candidate binary", () => {
  for (const entry of archiveBindings) assert.equal(entry.candidateSha256, entry.historicalE36Sha256);
  assert.equal(report.archiveOverlay.destination, join(report.root, "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"));
  assert.equal(digest(readFileSync(report.archiveOverlay.destination)), "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66");
  assert.deepEqual(report.archive.counts, { tests: 11, pass: 11, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
});
check("three actual outer tar controls execute no tests or wrong tool", () => {
  for (const name of ["env-only", "missing", "wrong"]) {
    const negative = readJson(`${name}-result.json`);
    assert.equal(readJson(`${name}-outer.json`).status, 78);
    assert.equal(negative.setup.executedTests, 0);
    assert.equal(negative.steps.length, 0);
    assert.equal(existsSync(join(negative.root, "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar")), false);
    assert.equal(negative.archiveSetup.assets.find(asset => asset.name === "gnu")?.execution, undefined);
  }
});
check("build first, strict actual declarations, all22 maintained inputs", () => {
  assert.equal(report.steps[0].name, "current-consumers-build");
  assert.equal(report.steps[0].status, 0);
  assert.equal(report.currentConsumers.groups.length, 13);
  assert.equal(report.currentConsumers.groups.flatMap(group => group.inputs).length, 22);
  for (const group of report.currentConsumers.groups) {
    assert.equal(group.compile, "pass");
    const workspace = dirname(group.inputs[0].target);
    const config = JSON.parse(readFileSync(join(workspace, "tsconfig.json")));
    assert.equal(config.compilerOptions.strict, true);
    assert.equal(config.compilerOptions.skipLibCheck, false);
    assert.equal(config.compilerOptions.moduleResolution, "NodeNext");
    assert.equal(config.compilerOptions.paths, undefined);
    const listing = report.steps.find(step => step.name === `consumer-${group.name}-resolution`).stdout.trim().split("\n");
    assert.ok(listing.includes(join(report.directory, "consumer/node_modules/virtual-bash/dist/index.d.ts")));
    assert.ok(!listing.some(path => path.startsWith(join(report.root, "src/"))));
  }
});
check("permission guards remain without child-process waiver", () => {
  for (const step of report.steps.filter(step => step.command.includes("--experimental-permission"))) {
    assert.ok(!step.command.some(argument => argument.startsWith("--allow-child-process")));
  }
  assert.equal(readJson("positive/current-consumer-source-denied.json").status, 1);
  assert.match(readJson("positive/current-consumer-source-denied.json").stderr, /ERR_ACCESS_DENIED/u);
  assert.equal(report.currentConsumers.groups.find(group => group.name === "webdav-loopback").inputs.find(input => input.path.endsWith("provider.mts")).sha256, digest(readAt(report.sourceCommit, "tests/fs/webdav/consumer/provider.mts")));
});
check("positive failure retained, not relabeled by later phases", () => {
  assert.equal(readJson("positive-outer.json").status, 1);
  assert.equal(report.exitCode, 1);
  const webdav = report.steps.find(step => step.name === "consumer-webdav-loopback-consumer.test.mjs");
  assert.equal(webdav.status, 1);
  assert.match(webdav.stdout, /EAGAIN: resource temporarily unavailable, utimes '\/remote\/target'/u);
  assert.match(webdav.stdout, /^# tests 13$/mu);
  assert.match(webdav.stdout, /^# pass 12$/mu);
  assert.match(webdav.stdout, /^# fail 1$/mu);
  assert.match(webdav.stdout, /^# skipped 0$/mu);
  assert.match(report.error, /mandatory current consumers failed/u);
});
check("three independent type negatives retain exact intended errors", () => {
  const negatives = readJson("independent-type-controls.json").controls;
  assert.equal(negatives.length, 3);
  assert.ok(negatives.every(entry => entry.passed && entry.originalFilesUnchanged));
  assert.deepEqual(negatives.find(entry => entry.name === "intended-type-error").errors, ["TS2322"]);
});
check("native member-group, pins, metadata and strict stream scope", () => {
  assert.equal(report.canonicalSetup.assets.length, 15);
  assert.equal(report.canonicalSetup.issues.length, 0);
  assert.equal(report.fixtureAuthority.after.gid, 20);
  assert.ok(report.fixtureAuthority.groups.includes(20));
  assert.deepEqual(report.fixtureAuthority.probes.map(entry => entry.after.mode), ["2755", "6755"]);
  assert.equal(report.metadata.counts.pass, 318);
  assert.equal(report.metadata.counts.skipped, 0);
  assert.equal(report.metadata.nativeRowsPassed, 22);
  assert.equal(report.stream.summary.distinctPrimaryInputs, 82);
  assert.equal(report.stream.diagnosticSummary.strengthened, 164);
  assert.equal(report.stream.diagnosticSummary.strict, 124);
});
check("zero runtime dependencies and no candidate source mutation", () => {
  const packageJson = JSON.parse(readAt(report.sourceCommit, "package.json"));
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.equal(Object.keys(packageJson[key] ?? {}).length, 0);
  assert.equal(report.sourceUnchanged, true);
  assert.equal(report.testsUnchanged, true);
  assert.equal(report.indexBefore, report.indexAfter);
});
const tools = [process.execPath, realpathSync(join(dirname(process.execPath), "npm")), "node_modules/typescript/bin/tsc", "node_modules/typescript/lib/_tsc.js", "node_modules/typescript/package.json", "node_modules/tsx/package.json", "node_modules/@types/node/package.json"].map(path => ({ path, sha256: digest(readFileSync(path.startsWith("/") ? path : join(repository, path))) }));
const controls = [
  ["Q01", "PASS", "Root marker, immutable Git source/tree plus all205 source/config,380 test/support and20 harness entries independently authenticated."],
  ["Q02", "PASS", "156 tracked .mts paths:22 maintained,129 historical,1 explicitly pinned frozen time-env oracle,4 declarations. Original30 crosswalk12 maintained+18 historical."],
  ["Q03", "PASS", "All22 maintained inputs in13 strict NodeNext built-public-declaration groups; cold build first; no source resolution."],
  ["Q04", "FAIL", "Actual required WebDAV local runtime12/13 fails. Eleven other runtime groups exit0, including module-only imports; those imports and7 provider compile-only programs are not deployed workflow passes."],
  ["Q05", "PASS", "Missing dist TS2307; missing declaration TS7016; sole injected type error TS2322; source read denied. All original consumer inputs unchanged."],
  ["Q06", "FAIL", "Exact positive outer npm job exit1 on current02. Correct failure propagation is separately verified, not positive qualification."],
  ["Q07", "PASS", "Authentic GNUtar1.35 staged at exact candidate hardcoded path used by both suites; BSD/gzip/gunzip pins verified."],
  ["Q08", "PASS", "Only GNU_TAR environment with no explicit tar argument: outer78,zero tests,inner candidate has no staged tar."],
  ["Q09", "PASS", "Explicit missing owned tar: outer78,zero tests."],
  ["Q10", "PASS", "Exact wrong executable text pin: rejected by SHA before execution,outer78,zero tests."],
  ["Q11", "PASS", "Metadata15 pins;318/318+22 native rows;164 semantic/124 strict+40 diagnostics; existing65-name public scope,registry31/31,author packed21/21."],
  ["Q12", "PASS", "Current02 execution of both original archive suites11/11 zero skips; all4 input/helper hashes unchanged versus historicale36; historical runner not invoked."],
  ["Q13", "PASS", "Unsandboxed native reference uid501/gid20/member20,umask0022,owned fixture0700;0644->02755/06755 probes. Product Node permissions unchanged; no OS network isolation claim."],
  ["Q14", "PASS", "Integrity/scope only:zero runtime dependencies;frozen inputs unchanged;provider and source never patched;five cleanup failures OPEN;historical proof not relabeled current."],
].map(([id, status, detail]) => ({ id, status, detail }));
const output = { source: report.sourceCommit, sourceTree: git("rev-parse", `${report.sourceCommit}^{tree}`).toString().trim(), sourceTreeSha256: report.sourceTreeSha256, testTreeSha256: report.testTreeSha256, harnessSha256: report.harnessSha256, archiveSha256: report.archiveSha256, controls, counts: { pass: controls.filter(entry => entry.status === "PASS").length, fail: controls.filter(entry => entry.status === "FAIL").length, total: controls.length }, verdict: "POSITIVE QUALIFICATION FAIL; bounded verification complete", mechanicalEvidenceChecks: checks, archiveBindings, tools, originalPhase: "4504153 frozen inputs;bc03e68 static7 checks,not execution", finalPhase: "fresh independent02 execution; no545 counts reused", openOwners: ["Poincare: maintained WebDAV provider fixture timestamp extension; no authorization to fix in this leaf", "Root/runtime owner: five original cleanup failures remain OPEN; not independently closed here"] };
const patch = execFileSync("/usr/bin/which", ["apply_patch"], { encoding: "utf8" }).trim();
const target = join(evidence, "verified-controls.json");
assert.equal(existsSync(target), false);
execFileSync(patch, [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${target}\n${JSON.stringify(output, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
console.log(JSON.stringify({ evidenceChecksPassed: checks.length, controls: output.counts, verdict: output.verdict }));
