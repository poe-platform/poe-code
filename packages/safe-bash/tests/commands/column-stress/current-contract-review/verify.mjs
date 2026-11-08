import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const manifest = read("MANIFEST.json"), summary = read("capture-2/SUMMARY.json");
function files(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name), relative = prefix + name, stat = lstatSync(path);
    assert(!stat.isSymbolicLink());
    return stat.isDirectory() ? files(path, `${relative}/`) : [relative];
  });
}
assert.deepEqual(files(root).filter((path) => path !== "MANIFEST.json"), manifest.files.map((entry) => entry.path).sort());
for (const entry of manifest.files) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
assert.equal(summary.revision, "3af3f62890c528bd40da56514e4b08f44b2e6cf0");
const tree = execFileSync("git", ["ls-tree", "-rz", "--full-tree", summary.revision], { cwd: repository, maxBuffer: 16 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
for (const capture of ["capture-1", "capture-2"]) {
  const source = read(`${capture}/SOURCE.json`), built = read(`${capture}/BUILT.json`), pack = read(`${capture}/PACK.json`);
  assert.deepEqual(source.sourceFiles.map((entry) => `${entry.gitMode} blob ${entry.blob}\t${entry.path}`), tree);
  const sourceByPath = new Map(source.sourceFiles.map((entry) => [entry.path, entry]));
  const builtByPath = new Map(built.addedEntries.map((entry) => [entry.path, entry]));
  const packedByPath = new Map(pack.inventory.map((entry) => [entry.path, entry]));
  assert.equal(source.archiveSha256, summary.archiveSha256);
  assert.equal(pack.packSha256, summary.packSha256);
  const legacy = read(`${capture}/LEGACY.json`), hidden = read(`${capture}/ORIGINAL-HIDDEN.json`);
  for (const [field, path] of Object.entries({ recipeSha256: "tests/commands/column-stress/recipes.json", expectationsSha256: "tests/commands/column-stress/handoff-20260827/expectations.json", harnessSha256: "tests/commands/column-stress/handoff-20260827/stress.mjs", safetySha256: "tests/commands/column-stress/handoff-20260827/safety.mjs" })) assert.equal(legacy[field], sourceByPath.get(path).sha256);
  assert.equal(legacy.counts.topLevelRecipes, 40); assert.equal(legacy.counts.topLevelPass, 39); assert.equal(legacy.counts.topLevelFail, 1);
  assert.equal(legacy.counts.variantPass, 87); assert.equal(legacy.counts.variantFail, 1);
  assert.deepEqual(legacy.cases.filter((row) => row.verdict === "fail").map((row) => row.recipe), ["S38"]);
  assert.equal(legacy.recipeVerdicts.N01.verdict, "pass"); assert.equal(legacy.recipeVerdicts.N03.verdict, "pass");
  assert.deepEqual(legacy.unhandledRejections, []);
  assert.equal(hidden.acceptance, "HOLD"); assert.deepEqual(hidden.beforeGateRelease, { returns: 1, execSettled: true, disposeSettled: true });
  for (const name of files(join(root, capture)).filter((name) => name.endsWith(".command.json"))) {
    const command = read(`${capture}/${name}`);
    assert.equal(command.termination, null); assert.equal(command.spawnError, null); assert.equal(command.signal, null);
    assert.equal(command.cleanup, "child-close-observed-owned-process-group-retired");
  }
  for (const name of files(join(root, capture)).filter((name) => name.endsWith(".imports.ndjson"))) {
    const receipts = readFileSync(join(root, capture, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert(receipts.length > 100);
    for (const receipt of receipts) {
      let expected;
      if (receipt.path.startsWith(`${legacy.candidate}/dist/`)) expected = builtByPath.get(receipt.path.slice(legacy.candidate.length + 1))?.sha256;
      else if (receipt.path.startsWith(`${pack.movedTo}/`)) expected = packedByPath.get(receipt.path.slice(pack.movedTo.length + 1))?.sha256;
      else if (receipt.path === join(root, "probe.mjs")) expected = hash(readFileSync(join(root, capture === "capture-1" ? "capture-1/probe.mjs.txt" : "probe.mjs")));
      assert.equal(receipt.sha256, expected, receipt.path);
    }
    assert(receipts.some((receipt) => receipt.path.endsWith("/dist/index.js")));
    assert(receipts.some((receipt) => receipt.path.endsWith("/dist/commands/column/index.js")));
  }
  assert.deepEqual(pack.manifest.dependencies ?? {}, {});
  assert.equal(pack.manifest.exports["./commands/column"], undefined);
}
assert.deepEqual(summary.currentCounts, { total: 12, pass: 12, fail: 0 });
assert.deepEqual(summary.packedCounts, summary.currentCounts);
assert.deepEqual(summary.scopedTestCounts, { tests: 73, pass: 73, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.equal(summary.beforeInventorySha256, summary.afterInventorySha256); assert.equal(summary.newEntriesDetected, true);
for (const label of ["current", "packed-current"]) {
  const corpus = read(`capture-2/${label}.json`);
  assert.deepEqual(corpus.unhandledRejections, []);
  assert(corpus.cases.every((row) => row.status === "pass"));
  assert.deepEqual(corpus.cases.find((row) => row.id === "C07").beforeRelease, [false, false, false]);
  assert.deepEqual(corpus.cases.find((row) => row.id === "C11").negativeBeforeRelease, [true, true, true]);
}
for (const [mutant, message] of [["remove-registration", "barrier must remain pending"], ["wrong-output", "exact output detector"], ["wrong-error", "exact error identity"]]) {
  const result = read(`capture-2/mutant-${mutant}.json`);
  assert.deepEqual(result.counts, { total: 1, pass: 0, fail: 1 });
  assert(result.cases[0].failure.message.includes(message));
  assert.equal(read(`capture-2/mutant-${mutant}.command.json`).status, 1);
}
assert.deepEqual(read("capture-2/mutant-late-unhandled.json").unhandledRejections, ["Error: late-unhandled detector sentinel"]);
assert.equal(read("capture-2/mutant-late-unhandled.command.json").status, 1);
assert.deepEqual(read("capture-1/current.json").counts, { total: 12, pass: 11, fail: 1 });
assert.equal(read("capture-1/FAILED-AUDIT.json").allOriginalSourceBuildDependencyEntriesUnchanged, true);
const trace = Buffer.from(read("capture-2/packed-types.command.json").stdoutHex, "hex").toString();
assert(trace.includes("Module name 'virtual-bash' was successfully resolved to '"));
assert(trace.includes("/moved-offline/node_modules/virtual-bash/dist/index.d.ts'"));
assert(trace.includes("/moved-offline/node_modules/virtual-bash/dist/commands/column/index.d.ts'"));
assert.equal(read("CLOSURE.json").allOwnedSnapshotsRemoved, true);
console.log(JSON.stringify({ staticEvidence: "pass", sourceCandidate: summary.revision, current: "12/12", packed: "12/12", scoped: "73/73", legacy: "39/40, S38 failed", originalHidden: "exit 1 / HOLD", mutantsDetected: 4, acceptance: "not authorized" }));
