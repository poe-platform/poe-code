import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { directory, digest, read, json, put, putJson } from "./common.mjs";

const commit = process.argv[2];
assert.match(commit ?? "", /^[a-f0-9]{40}$/u);
const admission = json(join(directory, "ADMISSION.json"));
assert.equal(admission.commit, commit);
const report = existsSync(join(directory, "REPORT.json")) ? json(join(directory, "REPORT.json")) : null;
const finalization = existsSync(join(directory, "FINALIZATION.json")) ? json(join(directory, "FINALIZATION.json")) : null;
const counts = report?.counts ?? { plannedRuntimeAssertions: 104, executed: 0, pass: 0, fail: 0, unrun: 104, controlsExecuted: 0, controlsPass: 0, typeInvocations: 0, typePass: 0 };
const blockers = [
  ...(admission.status === "qualified" ? [] : [{ name: "reader-admission", error: admission.error }]),
  ...(report?.failures ?? []),
  ...(finalization?.status === "pass" ? [] : [{ name: "finalization", error: "No successful finalization receipt" }]),
];
const independentBuild = report?.P01 ?? { status: "unrun" };
const passed = admission.status === "qualified" && independentBuild.status === "pass" && counts.pass === 104 && counts.typePass === 40 && blockers.length === 0;
const failures = report?.contexts.flatMap(context => context.cases.filter(row => row.status === "fail").map(row => ({ context: context.label, ...row }))) ?? [];
const seal = { schema: "expr-public-component-v3-final-evidence/1", finishedAt: new Date().toISOString(), recipeCommit: commit, scope: "EXPRPUBLICCOMPONENT", verdict: passed ? "PASS component-only" : "HELD / incomplete component qualification",
  candidate: "44f00bf84278e3361b52106478d59c707ab7b2bc", candidateTree: "5905cf8d43233c68ea2bd499275ada2641223d9a", sourceCommit: "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e",
  reader: { status: admission.status, controls: admission.controls, allChildrenClosedAtAdmission: admission.allChildrenClosed, childCountAtAdmission: admission.childCount },
  P01: independentBuild, counts, individualFailures: failures, blockers, runtimeArtifact: report?.runtimeArtifact ?? "none executed", allProcessChildrenClosed: report?.allProcessChildrenClosed ?? admission.allChildrenClosed,
  finalization, acceptedDUGate: "HELD and unrescored", HTML: "accepted separately per root; no rerun here", whole76: "not executed or accepted here", originalGate: "HELD, unchanged", artifacts: [] };
const names = ["PINS.json", "OVERLAY.json", "RECIPE-SEAL.json", "PREPARATION.json", "EXECUTION.raw.txt", "ADMISSION.json", "ADMISSION.raw.jsonl", "REPORT.json", "MANIFEST.json", "RAW.json.gz.base64", "FINALIZATION.json"];
for (const name of names) {
  const path = join(directory, name); if (!existsSync(path)) continue;
  const stat = lstatSync(path); assert.ok(stat.isFile());
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) { bytes += chunk.length; hash.update(chunk); }
  assert.equal(bytes, stat.size); seal.artifacts.push({ path: name, bytes, mode: stat.mode & 0o777, sha256: hash.digest("hex") });
}
putJson(join(directory, "EVIDENCE-SEAL.json"), seal);
const text = `# EXPRPUBLICCOMPONENT v3: ${seal.verdict}\n\nRecipe commit: ${commit}. Authorization label: August 28, 2026.\n\nReader admission: ${admission.status}; ${admission.controls.pass ?? 0}/${admission.controls.controls ?? 16} qualified controls.\nP01: ${independentBuild.status}; runtime artifact: ${seal.runtimeArtifact}.\nRuntime assertions: ${counts.pass} pass, ${counts.fail} fail, ${counts.unrun} unrun /104.\nTypes: ${counts.typePass}/${counts.typeInvocations}; package controls: ${counts.controlsPass}/${counts.controlsExecuted}.\nObserved process children closed: ${seal.allProcessChildrenClosed}; postcheck: ${finalization?.status ?? "missing"}.\n\n${blockers.map(row => `- ${row.name}: ${typeof row.error === "string" ? row.error : row.error?.message ?? JSON.stringify(row.error)}`).join("\n")}\n\nAccepted-DU and original gate remain HELD, unchanged and unrescored. HTML was accepted separately by root; no HTML/DU/TAP run here. No whole76/fullgate claim. V1 failures and unqualified v2 drafts are retained unchanged. Raw receipts and generated work remain available; no retry or product repair.\n`;
put(join(directory, "REPORT.md"), text);
console.log(JSON.stringify({ verdict: seal.verdict, counts, P01: independentBuild, blockers: blockers.length, evidenceSealSha256: digest(read(join(directory, "EVIDENCE-SEAL.json"))), manifestSha256: seal.artifacts.find(row => row.path === "MANIFEST.json")?.sha256 }));
