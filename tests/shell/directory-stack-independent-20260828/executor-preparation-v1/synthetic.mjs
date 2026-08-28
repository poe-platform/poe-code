import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinModules } from "node:module";
import { requireAuthority, snapshot, assertSnapshot, copyRegular, safeRelative, sha256 } from "./integrity.mjs";
import { barrier, cooperativeOwner, boundedSink, continuationAllowed } from "./lifecycle.mjs";
import { runBoundedChild } from "./child-process.mjs";
import { describeCase, programFor, quote, gaps } from "./adapters.mjs";
import { assertObservation } from "./public-cases.mjs";
import { inversions, invert, validateDiagnostics } from "./types.mjs";
import { requireMechanism } from "./mechanisms.mjs";
import { executeAuthorized } from "./executor.mjs";

const preparation = fileURLToPath(new URL("./", import.meta.url));
const workRoot = resolve(preparation, "synthetic-work");
assert(!existsSync(workRoot), "refuse to overwrite an earlier synthetic scratch tree");
mkdirSync(workRoot);
const work = mkdtempSync(resolve(workRoot, "run-"));
const results = [];
async function check(id, operation) {
  const start = Date.now();
  try { const evidence = await operation(); results.push({ id, status: "pass", milliseconds: Date.now() - start, ...(evidence === undefined ? {} : { evidence }) }); }
  catch (error) { results.push({ id, status: "fail", milliseconds: Date.now() - start, error: { name: error.name, message: error.message, stack: error.stack } }); }
}
const rows = JSON.parse(readFileSync(new URL("../freeze-v1/cases.json", import.meta.url), "utf8")).cases;
const negatives = readFileSync(new URL("./types-negative.mts.fixture", import.meta.url), "utf8");
const validShape = () => ({ kind: "root-authorized-directory-stack-execution-v1", rootApprovalCommit: "a".repeat(40), rootApprovalPath: "tests/synthetic-only.json", rootApprovalSha256: "a".repeat(64), acceptedLetCommit: "b".repeat(40), acceptedLetEvidenceCommit: "c".repeat(40), acceptedCdLetBaseCommit: "d".repeat(40), acceptedCdLetBaseTree: "e".repeat(40), stackCandidateCommit: "f".repeat(40), stackCandidateTree: "1".repeat(40), authorEvidenceCommit: "2".repeat(40), preparationCommit: "3".repeat(40), rootStackGo: true, stackWindowReleased: true, acceptedCdCommit: "4641075df5355a91c83bf5b2cc3a88dfaf1f5153", productDelta: ["src/shell/runtime.ts", "src/shell/shell.ts"], preparedDriverScope: "explicit-selected-rows-not-138-pass", noLiveOverlay: true, toolchainRegularAndPinned: true, moduleClosureQualification: "main-thread-ESM-no-unadmitted-worker-or-CJS-path", sourceInputs: { "package.json": {}, "tsconfig.build.json": {}, "src/index.ts": {} }, tools: { root: "synthetic", inventory: {}, node: {}, tsc: "synthetic", npmCli: "synthetic", tsxPreload: "synthetic" }, authorProductHashes: { synthetic: true }, baseProductHashes: { synthetic: true }, publicConsumerInventory: { synthetic: true }, canonicalTypeScriptInventory: { synthetic: true }, caseIds: ["B01"], expectedPackageSha256: "4".repeat(64), expectedPackageInventory: { files: {}, directories: [] } });
try {
  await check("Y01", () => assert.throws(() => requireAuthority(null)));
  await check("Y02", async () => { await assert.rejects(executeAuthorized(null, "a".repeat(40))); return { productCallbacks: 0, role: "gate refusal before Git/build/import" }; });
  await check("Y03", () => { const value = validShape(); value.stackCandidateCommit = value.acceptedCdCommit; assert.throws(() => requireAuthority(value)); });
  await check("Y04", () => { const value = validShape(); value.acceptedCdLetBaseCommit = "HEAD"; assert.throws(() => requireAuthority(value)); });
  await check("Y05", () => { const value = validShape(); value.stackWindowReleased = false; assert.throws(() => requireAuthority(value)); });
  await check("Y06", () => { const value = validShape(); value.productDelta.push("src/shell/types.ts"); assert.throws(() => requireAuthority(value)); });
  await check("Y07", () => { requireAuthority(validShape()); return { role: "schema-only synthetic record; never used to execute/build/import product" }; });
  await check("Y08", () => { for (const path of ["../outside", "/absolute", "a/../b", "a\\b", "a\0b"]) assert.throws(() => safeRelative(path)); });
  const source = resolve(work, "regular-source"); mkdirSync(source); writeFileSync(resolve(source, "file.txt"), "fixture\n");
  const original = snapshot(source);
  await check("Y09", () => { copyRegular(source, resolve(work, "regular-copy"), original); assertSnapshot(source, original); });
  await check("Y10", () => { writeFileSync(resolve(source, "extra.txt"), "extra"); assert.throws(() => assertSnapshot(source, original)); rmSync(resolve(source, "extra.txt")); });
  await check("Y11", () => { mkdirSync(resolve(source, "empty")); assert.throws(() => assertSnapshot(source, original)); rmSync(resolve(source, "empty"), { recursive: true }); });
  await check("Y12", () => { symlinkSync(resolve(source, "file.txt"), resolve(source, "alias")); assert.throws(() => snapshot(source)); rmSync(resolve(source, "alias")); });
  await check("Y13", () => { writeFileSync(resolve(source, "file.txt"), "changed\n"); assert.throws(() => assertSnapshot(source, original)); writeFileSync(resolve(source, "file.txt"), "fixture\n"); });
  await check("Y14", () => { assert.equal(quote("a'b\n$()"), "'a'\\''b\n$()'"); assert.throws(() => quote("\0")); });
  await check("Y15", () => { const mappings = rows.map(describeCase); assert.equal(mappings.length, 138); assert.equal(mappings.filter((entry) => entry.status === "bounded-adapter-gap").length, 14); assert.equal(Object.keys(gaps).length, 14); return { preparedAdapters: 124, boundedGaps: 14, productRowsRun: 0 }; });
  await check("Y16", () => { let lowered = 0; for (const row of rows) { const entry = describeCase(row); if (entry.route === "same-exec-public") { const program = programFor(row); assert(program.source.includes('__ds_status "$?"')); assert(program.source.includes("dirs -l -p")); assert(program.source.length < 300000); lowered++; } } return { loweredPrograms: lowered, role: "source-string construction only; no Shell/parser execution" }; });
  await check("Y17", () => { const value = programFor(rows.find((row) => row.id === "B13")); assert(value.source.indexOf("pushd -n -- '/a'") < value.source.indexOf("pushd -n -- '/b'")); assert(value.source.includes("'pushd' '-n' '+1'")); });
  await check("Y18", () => { const row = rows.find((entry) => entry.id === "F02"); const before = { cwd: "/c", env: {}, namespace: [] }; const observed = { status: 1, stdout: "", stderr: "pushd: /missing: no such file or directory\n", probe: "/c\n/a\n/c\n", snapshots: { before, after: before }, readonlyBefore: "", readonlyAfter: "", calls: [], host: {}, chunks: [] }; assertObservation(row, { full: row.full }, observed); assert.throws(() => assertObservation(row, { full: row.full }, { ...observed, probe: "/c\n/missing\n/a\n" })); return { role: "assertion checker fed synthetic frozen observations, not a stack model/runtime measurement" }; });
  for (const mutation of inversions) await check("Y" + String(19 + inversions.indexOf(mutation)).padStart(2, "0"), () => { const inverted = invert(negatives, mutation.id); const lines = inverted.split("\n"); for (let index = 0; index < lines.length; index++) if (index !== mutation.line - 1) assert.equal(lines[index], negatives.split("\n")[index]); assert(!lines[mutation.line - 1].includes(mutation.from)); });
  await check("Y27", () => { const output = inversions.map((entry) => `negative.mts(${entry.line},${negatives.split("\n")[entry.line - 1].indexOf(entry.token) + 1}): error TS${entry.code}: synthetic diagnostic`).join("\n"); validateDiagnostics(output, negatives); assert.throws(() => validateDiagnostics(output.replace("TS2353", "TS2307"), negatives)); return { role: "synthetic diagnostic parser, not TypeScript declaration compilation" }; });
  await check("Y28", async () => { const hold = barrier(); const owner = cooperativeOwner(); const work = owner.admit(() => hold.hold()); await hold.entered; const first = owner.close(); assert.equal(owner.close(), first); assert.throws(() => owner.admit(() => {})); assert.equal(owner.pending, 1); hold.release(); await work; await first; assert.equal(owner.pending, 0); });
  await check("Y29", async () => { const left = cooperativeOwner(); const right = cooperativeOwner(); const hold = barrier(); const pending = right.admit(() => hold.hold()); await hold.entered; await left.close(); assert.equal(right.closed, false); hold.release(); await pending; await right.close(); });
  await check("Y30", async () => { const hold = barrier(); const sink = boundedSink({ hold: () => hold.hold() }); const bytes = Uint8Array.of(1, 2); const write = sink.write(bytes); await hold.entered; hold.release(); await write; bytes[0] = 9; assert.deepEqual(sink.chunks[0], Uint8Array.of(1, 2)); assert.equal(sink.maximumInFlight, 1); });
  await check("Y31", async () => { const reason = new Error("synthetic-write"); const sink = boundedSink({ failAt: 2, failure: reason }); await sink.write(Uint8Array.of(1)); await assert.rejects(sink.write(Uint8Array.of(2)), (error) => error === reason); assert.equal(sink.bytes, 1); });
  await check("Y32", () => { assert(continuationAllowed({ kind: "assertion-failure", natural: true, closed: true, intact: true, timedOut: false, leak: false })); for (const key of ["natural", "closed", "intact"]) assert(!continuationAllowed({ kind: "assertion-failure", natural: true, closed: true, intact: true, timedOut: false, leak: false, [key]: false })); });
  await check("Y33", async () => { const result = await runBoundedChild(process.execPath, ["-e", "process.stdout.write('synthetic-tool')"], { cwd: work, env: {}, timeoutMs: 3000 }); assert(result.natural && result.stdout === "synthetic-tool"); return result; });
  await check("Y34", async () => { const result = await runBoundedChild(process.execPath, ["-e", "setInterval(()=>{},100)"], { cwd: work, env: {}, timeoutMs: 30 }); assert(result.timedOut && result.closed && !result.natural); assert(!continuationAllowed({ ...result, kind: "assertion-failure", intact: true })); return { ...result, role: "intentional synthetic watchdog negative, not product timeout" }; });
  await check("Y35", () => { const witness = { kind: "pass", natural: true, intact: true, report: { status: "public-assertions-pass" }, id: "S02", candidateCommit: "a".repeat(40), loadedFiles: ["synthetic"] }; const binding = { family: "U01", role: "candidate-specific-postsource-binding-not-precode-predicate", variantSealCommit: "b".repeat(40), variantPackageSha256: "c".repeat(64), candidateCommit: witness.candidateCommit, baselineReceiptSha256: sha256(Buffer.from(JSON.stringify(witness))), parsedAndBuiltVariant: true, buildReceiptSha256: "d".repeat(64), targetPaths: ["src/shell/runtime.ts"] }; requireMechanism(binding, witness); assert.throws(() => requireMechanism({ ...binding, parsedAndBuiltVariant: false }, witness)); assert.throws(() => requireMechanism({ ...binding, family: "U08" }, witness)); return { role: "mechanism receipt/schema fixture only; no candidate or mutant executed" }; });
  const importRoot = resolve(work, "import-fixture"); mkdirSync(importRoot);
  const dependency = resolve(importRoot, "dependency.mjs"); const entry = resolve(importRoot, "entry.mjs");
  const standardEntry = "import { fixtureMarker } from './dependency.mjs'; export { fixtureMarker };\n";
  writeFileSync(dependency, "export const fixtureMarker = 'synthetic-only-not-Shell';\n"); writeFileSync(entry, standardEntry);
  const baselineTree = snapshot(importRoot);
  const fixtureFiles = () => Object.fromEntries(Object.entries(snapshot(preparation).files).filter(([path]) => path.endsWith(".mjs")).map(([path, identity]) => [resolve(preparation, path), identity]));
  const baselineFiles = fixtureFiles();
  async function importFixture(name, files = baselineFiles) {
    const admissionPath = resolve(work, name + "-admission.json"); const tracePath = resolve(work, name + "-loads.jsonl"); writeFileSync(tracePath, "", { flag: "wx" });
    writeFileSync(admissionPath, JSON.stringify({ kind: "synthetic-import-fixture-v1", publicEntry: entry, productRoots: [importRoot], files, tracePath, builtins: builtinModules.map((name) => name.startsWith("node:") ? name : "node:" + name) }), { flag: "wx" });
    const result = await runBoundedChild(process.execPath, ["--experimental-loader", resolve(preparation, "load-hook.mjs"), resolve(preparation, "import-probe.mjs")], { cwd: work, env: { DS_ADMISSION: admissionPath }, timeoutMs: 5000 });
    assert(result.natural && result.code === 0 && result.stdout.startsWith("IMPORT_ATTEMPT\n"), result.stdout + result.stderr);
    return { ...result, report: JSON.parse(result.stdout.split("\n")[1]), trace: readFileSync(tracePath, "utf8") };
  }
  await check("Y36", async () => { const result = await importFixture("baseline"); assert.equal(result.report.imported, true); assert(result.trace.includes(entry)); return result; });
  await check("Y37", async () => { writeFileSync(dependency, "export const fixtureMarker = 'changed';\n"); try { const result = await importFixture("changed"); assert.equal(result.report.imported, false); assert(/SHA256|size|strictly equal/.test(result.report.message)); return result; } finally { writeFileSync(dependency, "export const fixtureMarker = 'synthetic-only-not-Shell';\n"); } });
  await check("Y38", async () => { rmSync(entry); try { const result = await importFixture("missing"); assert.equal(result.report.imported, false); return result; } finally { writeFileSync(entry, standardEntry); } });
  await check("Y39", async () => { const foreign = resolve(work, "foreign.mjs"); writeFileSync(foreign, "export const foreign = true;\n"); writeFileSync(entry, "import '../foreign.mjs';\n"); try { const files = fixtureFiles(); delete files[foreign]; const result = await importFixture("foreign", files); assert.equal(result.report.imported, false); assert(result.report.message.includes("unadmitted module")); return result; } finally { writeFileSync(entry, standardEntry); } });
  await check("Y40", async () => { writeFileSync(entry, "import 'child_process';\n"); try { const result = await importFixture("native-refusal", fixtureFiles()); assert.equal(result.report.imported, false); assert(result.report.message.includes("native/require fallback refused")); return result; } finally { writeFileSync(entry, standardEntry); } });
  await check("Y41", async () => { writeFileSync(resolve(importRoot, "unused.txt"), "extra"); try { const result = await importFixture("append"); assert.equal(result.report.imported, true); assert.throws(() => assertSnapshot(importRoot, baselineTree)); return result; } finally { rmSync(resolve(importRoot, "unused.txt")); } });
  await check("Y42", async () => { const parserPath = resolve(preparation, "../../../../node_modules/typescript/lib/typescript.js"); assert(existsSync(parserPath), "optional syntax tool unavailable; record as failed/blocked syntax check, not type pass"); const module = await import(pathToFileURL(parserPath).href); const ts = module.default ?? module; for (const name of ["types-positive.mts.fixture", "types-negative.mts.fixture"]) { const source = ts.createSourceFile(name.replace(".fixture", ""), readFileSync(resolve(preparation, name), "utf8"), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS); assert.equal(source.parseDiagnostics.length, 0); } return { role: "TypeScript syntax parsing ONLY; no program/declaration resolution/typecheck/emit", parserSha256: sha256(readFileSync(parserPath)), version: ts.version }; });
} finally {
  rmSync(work, { recursive: true }); rmSync(workRoot, { recursive: true });
}
const report = { kind: "synthetic-preparation-only", at: new Date().toISOString(), checks: results, passed: results.filter((entry) => entry.status === "pass").length, failed: results.filter((entry) => entry.status === "fail").length, productBuilds: 0, productImports: 0, productTypeCompiles: 0, nativeOracleRuns: 0, providerRequests: 0, cohortRuns: 0, scratchRemoved: !existsSync(workRoot), node: process.version, nodeSha256: sha256(readFileSync(process.execPath)) };
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (report.failed) process.exitCode = 1;
