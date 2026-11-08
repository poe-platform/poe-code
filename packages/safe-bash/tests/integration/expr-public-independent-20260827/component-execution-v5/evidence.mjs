import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, lstatSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { directory, json, put, putJson, read, digest, flush } from "./common.mjs";

export async function fileHash(path) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}
export async function archiveRaw(rawDirectory, commit, report) {
  const names = readdirSync(rawDirectory).sort(), entries = [];
  let totalBytes = 0;
  async function* records() {
    for (const name of names) {
      const path = join(rawDirectory, name), stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink());
      const hash = createHash("sha256"); let bytes = 0;
      yield JSON.stringify({ kind: "file", path: name, mode: stat.mode & 0o777, bytes: stat.size }) + "\n";
      for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
        bytes += chunk.length; totalBytes += chunk.length; assert.ok(totalBytes <= 2147483648, "fixed 2GiB aggregate raw archive limit");
        hash.update(chunk); yield JSON.stringify({ kind: "chunk", base64: chunk.toString("base64") }) + "\n";
      }
      assert.equal(bytes, stat.size); const row = { path: name, mode: stat.mode & 0o777, bytes, sha256: hash.digest("hex") };
      entries.push(row); yield JSON.stringify({ kind: "end", ...row }) + "\n";
    }
  }
  const archive = join(directory, "RAW.jsonl.gz");
  await pipeline(Readable.from(records()), createGzip({ level: 9 }), createWriteStream(archive, { flags: "wx", mode: 0o644 }));
  flush(archive);
  putJson(join(directory, "MANIFEST.json"), { schema: "expr-v5-streamed-raw/1", commit, format: "gzip NDJSON file/chunk/end; decoded chunks at most 65536 bytes; untouched per-channel bytes", totalRawBytes: totalBytes,
    archive: { path: "RAW.jsonl.gz", ...await fileHash(archive) }, entries, counts: report.counts, P01: report.P01 });
}
export async function sealEvidence(commit, outer) {
  const optional = name => existsSync(join(directory, name)) ? json(join(directory, name)) : undefined;
  const report = optional("REPORT.json"), controls = optional("TRACE-CONTROLS.json"), verdict = optional("VERDICT.json"), finalization = optional("FINALIZATION.json");
  const seal = { schema: "expr-v5-final-evidence/1", authorizationDate: "2026-08-28", recipeCommit: commit, recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), outer, verdict,
    scope: "EXPRPUBLICCOMPONENT only", candidate: "44f00bf84278e3361b52106478d59c707ab7b2bc", tree: "5905cf8d43233c68ea2bd499275ada2641223d9a", source: "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e",
    P01: report?.P01 ?? { status: "unrun" }, controls: { planned: 38, pass: controls?.pass ?? 0, fail: controls?.fail ?? 0, unrun: controls?.unrun ?? 38 },
    counts: report?.counts ?? { plannedRuntimeAssertions: 104, pass: 0, fail: 0, unrun: 104, typeInvocations: 0, typePass: 0, typeFail: 0, typeUnrun: 40, controlsExecuted: 0, controlsPass: 0, controlsFail: 0, controlsUnrun: 36 },
    failures: report?.failures ?? [], finalization, allProcessChildrenClosed: report?.allProcessChildrenClosed ?? false, reusedReader: 16, reusedRepair: 28, newBuilds: 0,
    holds: ["accepted-DU and original gate remain HELD/unrescored", "root-selected DU75 is not acceptance", "HTML separately accepted, not rerun", "no whole76/fullgate/engine/TEMP acceptance"], artifacts: [] };
  put(join(directory, "REPORT.md"), `# EXPRPUBLICCOMPONENT v5: ${outer.exitCode === 0 ? "PASS component-only" : "HELD"}\n\nAuthorization: August 28, 2026. Recipe ${commit}.\nRecipe manifest ${seal.recipeManifestSha256}.\n\n- P01 ${seal.P01.status}; BOUND accepted v4 independent proof, NOT a fresh build.\n- Reader16 and repair28 reused, no replay. New controls ${seal.controls.pass}/38.\n- Runtime ${seal.counts.pass} pass / ${seal.counts.fail} fail / ${seal.counts.unrun} unrun of104.\n- Types ${seal.counts.typePass} pass / ${seal.counts.typeFail} fail / ${seal.counts.typeUnrun} unrun of40.\n- Package controls ${seal.counts.controlsPass} pass / ${seal.counts.controlsFail} fail / ${seal.counts.controlsUnrun} unrun of36.\n- Actual entry/outer exits ${outer.childStatus}/${outer.exitCode}. All runner children closed: ${seal.allProcessChildrenClosed}. Finalization: ${finalization?.status}.\n- Versioned phase order: package admission -> 26runtime -> types, per layout.\n- TRACE full raw streams and hashes are archived separately from bounded 1MiB previews.\n\n${seal.failures.map(row => `- ${row.name}: ${row.error}`).join("\n")}\n\n${seal.holds.join(". ")}. One presealed attempt, no retry.\n`);
  const names = ["RECIPE-SEAL.json", "PINS.json", "EXECUTION.raw.txt", "PRE-BINDINGS.json", "POST-BINDINGS.json", "TRACE-CONTROLS.json", "REPORT.json", "REPORT.md", "MANIFEST.json", "RAW.jsonl.gz", "FINALIZATION.json", "VERDICT.json", "OUTER.json"];
  for (const name of names) if (existsSync(join(directory, name))) seal.artifacts.push({ path: name, mode: lstatSync(join(directory, name)).mode & 0o777, ...await fileHash(join(directory, name)) });
  putJson(join(directory, "EVIDENCE-SEAL.json"), seal);
  return seal;
}
