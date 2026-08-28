import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSnapshot, copyRegular, inside, requireAuthority, snapshot, sha256 } from "./integrity.mjs";
import { authenticateAuthority, executeAuthorized } from "./executor.mjs";
import { runBoundedChild } from "./child-process.mjs";
import { compileTypes } from "./types.mjs";

const controls = JSON.parse(readFileSync(new URL("../freeze-v1/controls.json", import.meta.url), "utf8"));
const publicCaseIds = new Set(JSON.parse(readFileSync(new URL("../freeze-v1/cases.json", import.meta.url), "utf8")).cases.map((entry) => entry.id));
export function requireMechanism(binding, baselineWitness) {
  const family = controls.productMutants.find((entry) => entry.id === binding.family);
  assert(family, "unknown frozen family");
  assert.equal(binding.role, "candidate-specific-postsource-binding-not-precode-predicate");
  assert.match(binding.variantSealCommit ?? "", /^[a-f0-9]{40}$/);
  assert.match(binding.variantPackageSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(baselineWitness.kind, "pass");
  assert.equal(baselineWitness.natural, true);
  assert.equal(baselineWitness.intact, true);
  assert.equal(baselineWitness.report?.status, "public-assertions-pass");
  assert(publicCaseIds.has(baselineWitness.id), "private invariant cannot be a public passing witness");
  assert.equal(sha256(Buffer.from(JSON.stringify(baselineWitness))), binding.baselineReceiptSha256, "presealed baseline receipt identity required");
  assert(family.killBy.includes(baselineWitness.id), "source-only families cannot fabricate a dynamic witness");
  assert.equal(binding.candidateCommit, baselineWitness.candidateCommit);
  assert(baselineWitness.loadedFiles.length > 0, "actual passing candidate load proof required");
  assert.equal(binding.parsedAndBuiltVariant, true);
  assert.match(binding.buildReceiptSha256 ?? "", /^[a-f0-9]{64}$/);
  assert(binding.targetPaths.length > 0 && binding.targetPaths.every((path) => ["src/shell/runtime.ts", "src/shell/shell.ts"].includes(path)));
  return family;
}
export async function runSemanticVariant(binding, baselineWitness, variantAuthority, trustedRootCommit) {
  requireMechanism(binding, baselineWitness);
  requireAuthority(variantAuthority);
  assert.equal(variantAuthority.expectedPackageSha256, binding.variantPackageSha256);
  assert.equal(variantAuthority.stackCandidateCommit, binding.variantSealCommit);
  assert(variantAuthority.caseIds.includes(baselineWitness.id));
  const result = await executeAuthorized(variantAuthority, trustedRootCommit);
  const killed = result.results.filter((entry) => entry.id === baselineWitness.id && entry.kind === "assertion-failure" && entry.natural && entry.intact && entry.loadedFiles.length > 0);
  assert(killed.length > 0, "no valid runtime assertion kill; loader/build failures do not count");
  return { family: binding.family, killedLayouts: killed.map((entry) => entry.layout), role: binding.role };
}
export async function actualImportControl(authority, trustedRootCommit, control, config) {
  authenticateAuthority(authority, trustedRootCommit);
  assert(["Q01", "Q02", "Q03", "Q04"].includes(control), "Q05 is pre-import admission refusal; Q06 is actual type-harness refusal");
  assert.equal(config.baselineWitness.imported, true);
  assert.equal(config.baselineWitness.candidateCommit, authority.stackCandidateCommit);
  assert(config.baselineWitness.actualPublicRootLoaded && config.baselineWitness.natural && config.baselineWitness.intact);
  assert.equal(config.baselineWitness.admissionSha256, sha256(Buffer.from(JSON.stringify(config.admission))));
  assert.deepEqual(config.admission.authority, authority);
  const original = snapshot(config.sourceRoot);
  copyRegular(config.sourceRoot, config.variantRoot, original);
  const admission = structuredClone(config.admission);
  const remap = (path) => inside(config.sourceRoot, path) ? resolve(config.variantRoot, path.slice(resolve(config.sourceRoot).length + 1)) : path;
  admission.files = Object.fromEntries(Object.entries(admission.files).map(([path, identity]) => [remap(path), identity]));
  admission.publicEntry = remap(admission.publicEntry);
  admission.productRoots = admission.productRoots.map(remap);
  admission.tracePath = config.tracePath;
  admission.trustedRootCommit = trustedRootCommit;
  const target = control === "Q03" ? admission.publicEntry : resolve(config.variantRoot, config.targetRelative);
  assert(inside(config.variantRoot, target));
  if (["Q01", "Q02"].includes(control)) {
    assert(config.targetRelative.endsWith(control === "Q01" ? config.layout === "source" ? "runtime.ts" : "runtime.js" : config.layout === "source" ? "shell.ts" : "shell.js"));
    assert(config.baselineWitness.loadedFiles.includes(resolve(config.sourceRoot, config.targetRelative)), "target must have loaded in the actual successful baseline");
    writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("\n")]));
  } else if (control === "Q03") rmSync(target);
  else writeFileSync(resolve(config.variantRoot, "unexpected-entry.txt"), "synthetic-membership-control\n", { flag: "wx" });
  writeFileSync(config.admissionPath, JSON.stringify(admission), { flag: "wx" });
  writeFileSync(config.tracePath, "", { flag: "wx" });
  assert(admission.files[config.loader] && admission.files[config.probe], "use prebound staged loader/probe, never a live harness fallback");
  const result = await runBoundedChild(config.node, [...(config.preloads ?? []).map(remap).flatMap((path) => ["--import", path]), "--experimental-loader", config.loader, config.probe], { cwd: config.cwd, env: { ...config.env, DS_ADMISSION: config.admissionPath } });
  writeFileSync(config.resultPath, JSON.stringify(result), { flag: "wx" });
  assert(result.natural && result.code === 0 && result.stdout.startsWith("IMPORT_ATTEMPT\n"), "actual import must be reached; preload/loader startup failure is not a control pass");
  const report = JSON.parse(result.stdout.split("\n")[1]);
  if (control === "Q04") { assert.equal(report.imported, true); assert.throws(() => assertSnapshot(config.variantRoot, original)); }
  else { assert.equal(report.imported, false); assert(new RegExp(config.expectedRejection).test(report.message), "wrong admission failure"); }
  assertSnapshot(config.sourceRoot, original);
  return { control, layout: config.layout, actualImportAttempted: true, report, qualification: "candidate-bound actual import control, not semantic mutant" };
}
export async function admissionRefusalControl(authority, trustedRootCommit, badAuthorityPath, config) {
  authenticateAuthority(authority, trustedRootCommit);
  const changed = { ...authority, acceptedCdLetBaseCommit: "HEAD" };
  writeFileSync(badAuthorityPath, JSON.stringify(changed), { flag: "wx" });
  const result = await runBoundedChild(config.node, [fileURLToPath(new URL("./executor.mjs", import.meta.url)), badAuthorityPath, trustedRootCommit], { cwd: config.cwd, env: config.env });
  assert(result.natural && result.code !== 0 && result.stderr.includes("exact acceptedCdLetBaseCommit required"));
  return { control: "Q05", productImportAttempted: false, expectedBoundary: "reject before build/import", ...result };
}
export async function typeHarnessRefusalControl(authority, trustedRootCommit, config) {
  authenticateAuthority(authority, trustedRootCommit);
  assert(config.baselinePositiveTypesPassed && config.baselineCandidateCommit === authority.stackCandidateCommit);
  const original = snapshot(config.consumerRoot);
  copyRegular(config.consumerRoot, config.variantRoot, original);
  const packageRoot = resolve(config.variantRoot, "node_modules/virtual-bash");
  assert(inside(config.variantRoot, packageRoot));
  rmSync(packageRoot, { recursive: true });
  const output = resolve(config.variantRoot, "type-refusal-work");
  let rejected = false;
  try { await compileTypes(authority, "installed", { ...config.types, trustedRootCommit, consumerRoot: config.variantRoot, output }); }
  catch { rejected = true; }
  assert(rejected, "missing public package must fail the positive type harness");
  const receipt = JSON.parse(readFileSync(resolve(output, "positive/compiler-result.json"), "utf8"));
  assert(receipt.natural && receipt.code === 2 && /error TS2307:/.test(receipt.stdout), "wrong/missing compiler diagnostic is not intended refusal");
  assertSnapshot(config.consumerRoot, original);
  return { control: "Q06", role: "actual-positive-type-harness-refusal-not-negative-type-pass", receipt };
}
