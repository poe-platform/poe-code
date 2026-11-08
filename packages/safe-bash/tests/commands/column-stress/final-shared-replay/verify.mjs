import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const manifest = read("MANIFEST.json"), binding = read("capture-1/BINDING.json"), summary = read("capture-1/SUMMARY.json");
const source = read("capture-1/SOURCE.json"), built = read("capture-1/BUILT.json"), pack = read("capture-1/PACK.json");
function files(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap((name) => {
    const full = join(directory, name), path = prefix + name, stat = lstatSync(full);
    assert(!stat.isSymbolicLink());
    return stat.isDirectory() ? files(full, `${path}/`) : [path];
  });
}
assert.deepEqual(files(root).filter((path) => path !== "MANIFEST.json").sort(), manifest.files.map((entry) => entry.path).sort());
for (const entry of manifest.files) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
assert.equal(summary.revision, "0123c83d3aae72a15621acbb29a165b97b2c6ab6");
assert.equal(binding.revision, summary.revision);
assert.equal(binding.beforeAnyCandidateImport, true);
assert.deepEqual(binding.expectedBindings, { "src/shell/input.ts": "3eec71b72f87dd48ddac572d6e7feb9097d32be4", "src/commands/column": "8b32998383d1372a8624ac41d2e747551e5b6d4c", "src/commands/grep-aliases": "5e8ac069bfa6ead7a337130457cd6519f2066e2c" });
assert.equal(binding.wrapperSha256, hash(readFileSync(join(root, "run.mjs"))));
for (const ancestor of binding.verifiedAncestors) git("merge-base", "--is-ancestor", ancestor, summary.revision);
for (const [path, expected] of Object.entries(binding.expectedBindings)) assert.equal(git("rev-parse", `${summary.revision}:${path}`).toString().trim(), expected);
for (const fixture of binding.fixtures) assert.equal(hash(git("show", `${binding.fixtureCommit}:${fixture.path}`)), fixture.sha256);
assert.equal(binding.fixtures.find((fixture) => fixture.file === "probe.mjs").sha256, "ca527d7a6e57d497f1c8118e64e3c416133b3b5eb558ca9f766a1dbaf64bbb08");
const runner = git("show", `${summary.revision}:${binding.runner.path}`);
assert.equal(hash(runner), binding.runner.originalSha256);
assert.equal(hash(runner.toString().replaceAll(binding.runner.oldTemporary, binding.runner.temporary)), binding.runner.reboundSha256);
assert.equal(hash(readFileSync(join(root, "capture-1/bounded.mjs.txt"))), binding.runner.reboundSha256);
const tree = git("ls-tree", "-rz", "--full-tree", summary.revision).toString().split("\0").filter(Boolean);
assert.deepEqual(source.sourceFiles.map((entry) => `${entry.gitMode} blob ${entry.blob}\t${entry.path}`), tree);
assert.equal(source.sourceFiles.length, summary.sourceBlobCount);
const sourceByPath = new Map(source.sourceFiles.map((entry) => [entry.path, entry]));
const builtByPath = new Map(built.addedEntries.map((entry) => [entry.path, entry]));
const packedByPath = new Map(pack.inventory.map((entry) => [entry.path, entry]));
const legacy = read("capture-1/LEGACY.json"), hidden = read("capture-1/ORIGINAL-HIDDEN.json");
for (const path of ["tests/commands/column-stress/recipes.json", "tests/commands/column-stress/native-observations.json", "tests/commands/column-stress/owned-regressions.test.ts", ...["stress.mjs", "safety.mjs", "expectations.json", "root-hidden-return-repro.mjs"].map((name) => `tests/commands/column-stress/handoff-20260827/${name}`)]) assert.equal(hash(git("show", `${binding.fixtureCommit}:${path}`)), sourceByPath.get(path).sha256);
for (const [field, path] of Object.entries({ recipeSha256: "tests/commands/column-stress/recipes.json", expectationsSha256: "tests/commands/column-stress/handoff-20260827/expectations.json", harnessSha256: "tests/commands/column-stress/handoff-20260827/stress.mjs", safetySha256: "tests/commands/column-stress/handoff-20260827/safety.mjs" })) assert.equal(legacy[field], sourceByPath.get(path).sha256);
assert.equal(legacy.counts.topLevelRecipes, 40); assert.equal(legacy.counts.topLevelPass, 39); assert.equal(legacy.counts.topLevelFail, 1);
assert.equal(legacy.counts.executedVariants, 88); assert.equal(legacy.counts.variantPass, 87); assert.equal(legacy.counts.variantFail, 1);
assert.equal(legacy.counts.originalRecipeVariants, 84); assert.equal(legacy.counts.supplementalVariants, 4);
assert.deepEqual(legacy.cases.filter((row) => row.verdict === "fail").map((row) => row.recipe), ["S38"]);
assert.equal(legacy.recipeVerdicts.N01.verdict, "pass"); assert.equal(legacy.recipeVerdicts.N03.verdict, "pass");
assert.deepEqual(legacy.unhandledRejections, []);
assert.equal(hidden.acceptance, "HOLD"); assert.deepEqual(hidden.beforeGateRelease, { returns: 1, execSettled: true, disposeSettled: true });
assert.equal(read("capture-1/legacy.command.json").status, 1); assert.equal(read("capture-1/original-hidden.command.json").status, 1);
for (const label of ["current", "packed-current"]) {
  const result = read(`capture-1/${label}.json`);
  assert.deepEqual(result.counts, { total: 12, pass: 12, fail: 0 }); assert.deepEqual(result.unhandledRejections, []);
  assert.equal(read(`capture-1/${label}.command.json`).status, 0);
  assert(Date.parse(read(`capture-1/${label}.command.json`).startedAt) > Date.parse(binding.receiptAt));
  assert.deepEqual(result.cases.find((row) => row.id === "C07").beforeRelease, [false, false, false]);
  assert.deepEqual(result.cases.find((row) => row.id === "C11").negativeBeforeRelease, [true, true, true]);
  for (const row of result.cases.filter((row) => row.id !== "C12")) assert.equal(row.allOwnedGatesReleased, true);
}
for (const [mutant, message] of [["remove-registration", "barrier must remain pending"], ["wrong-output", "exact output detector"], ["wrong-error", "exact error identity"]]) {
  const result = read(`capture-1/mutant-${mutant}.json`);
  assert.deepEqual(result.counts, { total: 1, pass: 0, fail: 1 }); assert(result.cases[0].failure.message.includes(message));
  assert.deepEqual(result.unhandledRejections, []); assert.equal(read(`capture-1/mutant-${mutant}.command.json`).status, 1);
}
assert.deepEqual(read("capture-1/mutant-late-unhandled.json").unhandledRejections, ["Error: late-unhandled detector sentinel"]);
assert.equal(read("capture-1/mutant-late-unhandled.command.json").status, 1);
for (const command of summary.commands) {
  const result = read(`capture-1/${command.label}.command.json`);
  assert.equal(result.spawnError, null); assert.equal(result.groupAliveAfterRetirement, false);
  if (command.expectedTermination) { assert.equal(result.termination, command.expectedTermination); assert.equal(command.wrapperStatus, 1); }
  else { assert.equal(result.termination, null); assert.equal(result.signal, null); assert.equal(result.groupAliveAtClose, false); }
}
assert.equal(summary.commands.filter((row) => row.expectedTermination).length, 3);
for (const name of files(join(root, "capture-1")).filter((path) => path.endsWith(".imports.ndjson"))) {
  const receipts = readFileSync(join(root, "capture-1", name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(receipts.length, 181);
  for (const receipt of receipts) {
    let expected;
    if (receipt.path.startsWith(`${legacy.candidate}/dist/`)) expected = builtByPath.get(receipt.path.slice(legacy.candidate.length + 1))?.sha256;
    else if (receipt.path.startsWith(`${pack.movedTo}/`)) expected = packedByPath.get(receipt.path.slice(pack.movedTo.length + 1))?.sha256;
    else if (receipt.path === join(summary.temporary, "fixtures/probe.mjs")) expected = binding.fixtures.find((fixture) => fixture.file === "probe.mjs").sha256;
    assert.equal(receipt.sha256, expected, receipt.path);
  }
  assert(receipts.some((receipt) => receipt.path.endsWith("/dist/shell/input.js")));
  assert(receipts.some((receipt) => receipt.path.endsWith("/dist/commands/column/index.js")));
}
for (const entry of pack.inventory.filter((entry) => entry.kind === "file" && entry.path.startsWith("node_modules/virtual-bash/dist/"))) assert.equal(entry.sha256, builtByPath.get(entry.path.slice("node_modules/virtual-bash/".length))?.sha256);
assert.deepEqual(pack.manifest.dependencies ?? {}, {}); assert.equal(pack.manifest.exports["./commands/column"], undefined);
const trace = Buffer.from(read("capture-1/packed-types.command.json").stdoutHex, "hex").toString();
assert(trace.includes("Module name 'virtual-bash' was successfully resolved to '"));
assert(trace.includes("/moved-offline/node_modules/virtual-bash/dist/index.d.ts'"));
assert(trace.includes("/moved-offline/node_modules/virtual-bash/dist/commands/column/index.d.ts'"));
assert.deepEqual(summary.scopedTestCounts, { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
for (const label of ["build", "scoped-types", "scoped-tests", "packed-types"]) assert.equal(read(`capture-1/${label}.command.json`).status, 0);
assert.equal(summary.beforeInventorySha256, summary.afterInventorySha256);
assert.equal(summary.newEntriesDetected, true); assert.equal(summary.fixturesUnchanged, true);
assert.equal(summary.archiveSha256, source.archiveSha256); assert.equal(summary.packSha256, pack.packSha256);
const closure = read("CLOSURE.json"); assert.equal(closure.allOwnedSnapshotsRemoved, true);
assert.equal(closure.finalInventorySha256, summary.afterInventorySha256);
console.log(JSON.stringify({ staticEvidence: "pass", candidate: summary.revision, current: "12/12", packed: "12/12", ownedRegressions: "6/6", functionalRecipes: "39/39", legacy: "39/40; S38 failed", variants: "87/88", hidden: "exit 1 / HOLD", fixtureMutantsDetected: 4, runnerNegativesDetected: 3, integrationApproval: false }));
