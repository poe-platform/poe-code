import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { owned, repository, freeze, candidate, frozenPath, hash, save, record, exactBytes } from "./common.mjs";

const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
const base = await readFile(join(repository, frozenPath, "replay.mjs"));
exactBytes(base, pre.base.records.find(entry => entry.path === "replay.mjs"), "base runner");
let source = base.toString();
const changes = [];
function replaceOnce(label, before, after) {
  assert.equal(source.split(before).length - 1, 1, `${label} must have exactly one anchor`);
  source = source.replace(before, after);
  changes.push({ label, before, after });
}
replaceOnce("authenticated immutable supervisor and reviewer support imports",
  'import { ProcessManager, waitForPidExit } from "./harness/process-manager.mjs";',
  `import { ProcessManager, waitForPidExit } from ${JSON.stringify(pathToFileURL(join(repository, frozenPath, "harness/process-manager.mjs")).href)};\nimport { admitAdapter, expectedFixtureFiles, applyAuthenticatedOverlay, overlayReceipt } from "./adapter-support.mjs";`);
replaceOnce("exact revision admission before result creation",
  'if (candidate !== EXACT_CANDIDATE) throw new Error(`candidate must be exact ${EXACT_CANDIDATE}`);',
  'if (candidate !== EXACT_CANDIDATE) throw new Error(`candidate must be exact ${EXACT_CANDIDATE}`);\nawait admitAdapter(freezeCommit, candidate);');
replaceOnce("materialized fixture routing without editing base runner",
  'const taskRoot = dirname(fileURLToPath(import.meta.url));',
  `const taskRoot = materialized ? resolve(process.env.DU_V9_MATERIALIZED_ROOT ?? "") : ${JSON.stringify(join(repository, frozenPath))};`);
replaceOnce("base runner identity remains base identity",
  'const ownBytes = await readFile(fileURLToPath(import.meta.url));',
  'const ownBytes = await readFile(join(taskRoot, "replay.mjs"));');
replaceOnce("only changed harness uses declared overlay identity",
  'const expected = [...freeze.manifest.files, {',
  'const expected = [...expectedFixtureFiles(freeze.manifest.files, phase), {');
replaceOnce("explicit overlay-aware inventory receipts",
  '    completeFileCount: actual.length,',
  '    completeFileCount: actual.length,\n    identityBinding: overlayReceipt(phase),');
replaceOnce("authenticate pristine base before applying one-file overlay",
  '    const materializedBeforeChild = await verifyMaterializedTree(freeze, "bootstrap-materialized-before-child", extractedRoot);',
  '    await verifyMaterializedTree(freeze, "bootstrap-materialized-pristine-before-overlay", extractedRoot);\n    await applyAuthenticatedOverlay(extractedRoot, resultDirectory);\n    const materializedBeforeChild = await verifyMaterializedTree(freeze, "bootstrap-materialized-before-child", extractedRoot);');
replaceOnce("child uses separately bound reviewer adapter",
  '    const frozenRunner = join(extractedRoot, "replay.mjs");',
  '    const frozenRunner = fileURLToPath(import.meta.url);');
replaceOnce("child fixture root routing environment",
  '      env: { ...process.env, V6_REPOSITORY: repositoryReal },',
  '      env: { ...process.env, V6_REPOSITORY: repositoryReal, DU_V9_MATERIALIZED_ROOT: extractedRoot },');
replaceOnce("final result distinguishes pristine and patched binding",
  '      frozenManifestSha256: sha256(freeze.bytes),',
  '      frozenManifestSha256: sha256(freeze.bytes),\n      overlayBinding: overlayReceipt("complete-replay"),');
let reversed = source;
for (const change of [...changes].reverse()) reversed = reversed.replace(change.after, change.before);
assert.equal(reversed, base.toString());
const bytes = Buffer.from(source);
await save("replay-adapter.mjs", bytes);
await save("ADAPTER-DELTA.json", { baseRunnerSha256: hash(base), adapterSha256: hash(bytes), originalRunnerFileUntouched: true, productVerifierArgvEnvironmentOrderAndBudgetsUnchanged: true, additionalOrchestrationEnvironment: "DU_V9_MATERIALIZED_ROOT", changes });
const files = [];
for (const path of ["common.mjs", "review.mjs", "PRE.json", "PRE-TOOLS.json", "adapter-support.mjs", "build-adapter.mjs", "replay-adapter.mjs", "ADAPTER-DELTA.json", "launch.mjs"]) files.push(record(path, await readFile(join(owned, path))));
await save("EXECUTION-PRE.json", { at: new Date().toISOString(), freeze, candidate, files });
process.stdout.write(`Adapter: ${changes.length} explicit orchestration-only replacements; reverse reconstruction equals immutable runner.\n`);
