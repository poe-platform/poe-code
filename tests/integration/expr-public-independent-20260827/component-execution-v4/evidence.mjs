import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { directory, json, put, putJson, read, digest } from "./common.mjs";

export async function sealEvidence(commit, outer) {
  const optional = name => existsSync(join(directory, name)) ? json(join(directory, name)) : undefined;
  const report = optional("REPORT.json"), admission = optional("ADMISSION.json"), repair = optional("REPAIR-CONTROLS.json"), finalization = optional("FINALIZATION.json"), verdict = optional("VERDICT.json");
  const seal = { schema: "expr-v4-final-evidence/1", authorizationDate: "2026-08-28", finishedAt: new Date().toISOString(), recipeCommit: commit, recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))),
    scope: "EXPRPUBLICCOMPONENT", candidate: "44f00bf84278e3361b52106478d59c707ab7b2bc", tree: "5905cf8d43233c68ea2bd499275ada2641223d9a", source: "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e",
    verdict: outer.exitCode === 0 ? "PASS component-only" : "HELD", outer, aggregate: verdict,
    reader: { status: admission?.status ?? "unrun", controls: admission?.controls, selected: admission?.selected, finalReaderChildren: finalization?.readerChildCount },
    repair: { status: repair?.status ?? "unrun", pass: repair?.pass ?? 0, planned: 28 }, P01: report?.P01 ?? { status: "unrun" },
    counts: report?.counts ?? { plannedRuntimeAssertions: 104, executed: 0, pass: 0, fail: 0, unrun: 104, controlsExecuted: 0, controlsPass: 0, typeInvocations: 0, typePass: 0 },
    failures: report?.failures ?? [], runtimeArtifact: report?.runtimeArtifact ?? "none", allProcessChildrenClosed: report?.allProcessChildrenClosed ?? admission?.allChildrenClosed ?? false,
    finalization, holds: ["Accepted-DU and original gate HELD/unrescored", "HTML accepted separately; not rerun", "No whole76/fullgate/engine acceptance"], artifacts: [] };
  const names = ["RECIPE-SEAL.json", "PINS.json", "OVERLAY.json", "EXECUTION.raw.txt", "ADMISSION.json", "ADMISSION.raw.jsonl", "REPAIR-CONTROLS.json", "REPORT.json", "MANIFEST.json", "RAW.json.gz.base64", "FINALIZATION.json", "VERDICT.json", "OUTER.json"];
  for (const name of names) {
    const filename = join(directory, name); if (!existsSync(filename)) continue;
    const stat = lstatSync(filename), hash = createHash("sha256"); let bytes = 0;
    for await (const chunk of createReadStream(filename, { highWaterMark: 65536 })) { bytes += chunk.length; hash.update(chunk); }
    seal.artifacts.push({ path: name, bytes, mode: stat.mode & 0o777, sha256: hash.digest("hex") });
  }
  putJson(join(directory, "EVIDENCE-SEAL.json"), seal);
  put(join(directory, "REPORT.md"), `# EXPRPUBLICCOMPONENT v4: ${seal.verdict}\n\nAuthorization date: August 28, 2026. Recipe: ${commit}.\nRecipe manifest SHA-256: ${seal.recipeManifestSha256}.\n\n- Actual entry exit: ${outer.childStatus}; aggregate outer exit: ${outer.exitCode}.\n- Reader: ${seal.reader.status}; reused v3 16/16 qualification, no new reader controls.\n- Minimal-repair controls: ${seal.repair.pass}/28; ${seal.repair.status}.\n- P01: ${seal.P01.status}; runtime artifact: ${seal.runtimeArtifact}.\n- Runtime: ${seal.counts.pass} pass, ${seal.counts.fail} fail, ${seal.counts.unrun} unrun /104.\n- Types: ${seal.counts.typePass} passed /40, ${seal.counts.typeInvocations} executed.\n- Package controls: ${seal.counts.controlsPass} passed /36, ${seal.counts.controlsExecuted} executed.\n- Observed child closure: ${seal.allProcessChildrenClosed}; finalization: ${finalization?.status ?? "missing"}.\n\n${seal.failures.map(row => `- ${row.name}: ${row.error}`).join("\n")}\n\n${seal.holds.join(". ")}. V1/v2/v3 preserved; one v4 invocation, no retry. Chunk transport is bounded separately from the pinned 4,644,868-byte retained JSON; no whole-RSS or constant-memory claim.\n`);
  return seal;
}
