import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = "tests/integration/qualified-current-release-review";
const readyPath = "/tmp/safe-bash-qualified-current-release-review.ready";
const freeze = JSON.parse(readFileSync(new URL("./inputs.json", import.meta.url)));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("/usr/bin/git", ["--no-replace-objects", ...args], { cwd: repository, encoding: "buffer", timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
const text = (...args) => git(...args).toString().trim();
const readAt = (revision, path) => git("show", `${revision}:${path}`);
const args = process.argv.slice(2);
const preparation = args.length === 1 && args[0] === "--preparation";
assert.ok(preparation || args.length === 6 && args[0] === "--source" && args[2] === "--tree" && args[4] === "--release-command", "usage: audit.mjs --preparation OR --source SHA --tree TREE --release-command 'exact ready-marker command'");
assert.equal(text("rev-parse", "--show-toplevel"), repository);
assert.equal(digest(readFileSync(new URL("./FREEZE.md", import.meta.url))), freeze.controlDocumentSha256, "original control freeze changed");
assert.equal(digest(readFileSync(new URL("./prepare-freeze.mjs", import.meta.url))), freeze.preparationHarnessSha256, "original preparation harness changed");
const report = {
  schema: 1,
  mode: preparation ? "preparation-static-only" : "authorized-candidate-static-only",
  executedProductTests: 0,
  executedNativeTests: 0,
  executedBuilds: 0,
  executedPacks: 0,
  source: preparation ? freeze.preparationSource : args[1],
  ready: { path: readyPath, present: existsSync(readyPath), authorized: false },
  checks: [],
  unexecutedControls: Array.from({ length: 14 }, (_, index) => `Q${String(index + 1).padStart(2, "0")}`),
  openBlocks: ["Five public premature-cleanup failures remain OPEN; this static audit cannot resolve lifecycle acceptance.", "Product/native/build/pack and all runtime negative controls require separate authorized execution."],
  harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
  inputFreezeSha256: digest(readFileSync(new URL("./inputs.json", import.meta.url)))
};
const check = (name, operation) => {
  try { operation(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, message: error.message }); }
};
if (!preparation) {
  assert.match(args[1], /^[0-9a-f]{40}$/u, "immutable full source SHA required");
  assert.match(args[3], /^[0-9a-f]{40}$/u, "immutable full tree SHA required");
  assert.ok(report.ready.present, "root ready marker absent: execution not authorized");
  const ready = readFileSync(readyPath, "utf8");
  assert.match(ready, /ROOT-OBSERVED[\s\S]*author42631[\s\S]*CLOSED[\s\S]*code\s*(?:[:=]\s*)?0\b/u, "actual author closure/code0 missing");
  assert.ok(ready.includes(args[1]) && ready.includes(args[3]) && ready.includes(args[5]), "marker must bind exact supplied source/tree/outer command");
  assert.match(args[5], /npm run verify:release:qualified\b/u);
  assert.ok(args[5].includes(args[1]), "outer command must name immutable source");
  assert.match(ready, /prereq/iu, "explicit root prerequisites missing");
  assert.match(args[5], /--native-assets-from\s+\S+/u);
  assert.match(args[5], /--archive-tar-from\s+\S+/u);
  assert.equal(text("rev-parse", `${args[1]}^{tree}`), args[3]);
  report.ready = { ...report.ready, authorized: true, sha256: digest(ready), exactReleaseCommand: args[5] };
}
report.tree = text("rev-parse", `${report.source}^{tree}`);
const allPaths = text("ls-tree", "-r", "--name-only", report.source, "src", "tests", "scripts").split("\n");
const standalonePaths = allPaths.filter(path => path.endsWith(".mts") && !path.endsWith(".d.mts"));
const originalMap = new Map(freeze.original30.map(entry => [entry.path, entry]));
const frozenMap = new Map(freeze.standalone.map(entry => [entry.path, entry]));
report.census = standalonePaths.map(path => {
  const frozen = frozenMap.get(path);
  const original = originalMap.get(path);
  const sha256 = digest(readAt(report.source, path));
  return { path, sha256, preparationSha256: frozen?.sha256 ?? null, changedSincePreparation: frozen ? sha256 !== frozen.sha256 : null, original30: Boolean(original), original30Sha256: original?.sha256 ?? null, changedSinceOriginal30: original ? sha256 !== original.sha256 : null, disposition: frozen?.disposition ?? "UNCLASSIFIED-new-candidate-input", runtimeIntention: frozen?.runtimeIntention ?? "Requires explicit census delta; not silently excluded" };
});
report.counts = { standalone: report.census.length, maintained: report.census.filter(entry => entry.disposition === "maintained-strict-compile").length, historical: report.census.filter(entry => entry.disposition === "retained-historical-evidence-copy").length, declarations: allPaths.filter(path => path.endsWith(".d.mts")).length, original30Present: report.census.filter(entry => entry.original30).length };
check("all original30 paths accounted for", () => assert.equal(report.counts.original30Present, 30));
check("no new standalone path silently classified", () => assert.ok(report.census.every(entry => !entry.disposition.startsWith("UNCLASSIFIED"))));
const authorPaths = ["scripts/verify-qualified-release.mjs", "scripts/verify-current-consumers.mjs", "tests/plugins/qualified-current-release/consumers.mjs", "tests/plugins/qualified-current-release/prerequisites.mjs", "tests/plugins/qualified-current-release/snapshot.mjs", "tests/plugins/qualified-current-release/inventory.json", "tests/plugins/qualified-current-release/tsconfig.consumer.json"];
const authorRead = path => preparation ? readFileSync(`${repository}/${path}`) : readAt(report.source, path);
report.authorReview = { scope: preparation ? "uncommitted moving author bytes; static observation only, NOT final verification" : "exact authorized candidate bytes", files: authorPaths.map(path => ({ path, sha256: digest(authorRead(path)) })) };
const inventory = JSON.parse(authorRead("tests/plugins/qualified-current-release/inventory.json"));
const config = JSON.parse(authorRead("tests/plugins/qualified-current-release/tsconfig.consumer.json"));
check("author exact standalone inventory matches independent paths", () => assert.deepEqual(inventory.entries.filter(entry => !entry.path.endsWith(".d.mts")).map(entry => entry.path).sort(), standalonePaths.sort()));
check("author maintained classification matches independent per-path census", () => assert.deepEqual(inventory.entries.filter(entry => entry.classification === "current").map(entry => entry.path).sort(), report.census.filter(entry => entry.disposition === "maintained-strict-compile").map(entry => entry.path).sort()));
check("strict declarations without source paths configuration", () => {
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.skipLibCheck, false);
  assert.equal(config.compilerOptions.moduleResolution, "NodeNext");
  assert.equal(config.compilerOptions.paths, undefined);
  assert.equal(config.extends, undefined);
});
const packageJson = JSON.parse(readAt(report.source, "package.json"));
check("runtime dependencies empty", () => {
  for (const name of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.equal(Object.keys(packageJson[name] ?? {}).length, 0, name);
});
report.archiveInputs = freeze.sourceAndSupport.filter(entry => ["tests/commands/archive/native.test.ts", "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/pax-independent/controls.test.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts"].includes(entry.path)).map(entry => ({ path: entry.path, preparationSha256: entry.sha256, candidateSha256: digest(readAt(report.source, entry.path)), historicalE36Sha256: digest(readAt("e36dab2b6abc216ddc89e5786a0eba76f08a1722", entry.path)) }));
check("both original archive suites and support remain byte-identical", () => {
  assert.equal(report.archiveInputs.length, 4);
  for (const entry of report.archiveInputs) {
    assert.equal(entry.candidateSha256, entry.preparationSha256, entry.path);
    assert.equal(entry.candidateSha256, entry.historicalE36Sha256, entry.path);
  }
});
report.sourceFiles = allPaths.filter(path => path.startsWith("src/")).map(path => ({ path, sha256: digest(readAt(report.source, path)) }));
report.sourceFilesSha256 = digest(JSON.stringify(report.sourceFiles));
report.sourceAndSupportDelta = freeze.sourceAndSupport.flatMap(entry => {
  const sha256 = digest(readAt(report.source, entry.path));
  return sha256 === entry.sha256 ? [] : [{ path: entry.path, preparationSha256: entry.sha256, candidateSha256: sha256 }];
});
report.nativeProfile = { status: "NOT EXECUTED", gnuTarSha256: "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", exactRelativePath: "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar", required: "authenticated existing pins; member-group owned fixture parent; unsandboxed native reference, not packed product sandbox waiver", retainedEvidence: "historical archive 5/6 -> 11/11; original metadata 316/318; prior controlled 318/22; SGID6 differences unchanged" };
report.status = report.checks.every(entry => entry.passed) ? "STATIC-CHECKS-PASS-NOT-RELEASE-QUALIFIED" : "STATIC-CHECK-FAILURE";
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.checks.every(entry => entry.passed) ? 0 : 1;
