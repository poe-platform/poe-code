import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { directory, read, json, digest, flush, put, putJson } from "./common.mjs";

export async function fileHash(path) {
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}
export async function archiveRaw(commit) {
  const rawDirectory = join(directory, "work/run-001/raw"), entries = [];
  if (!existsSync(rawDirectory)) return;
  const before = readdirSync(rawDirectory).sort();
  let totalRawBytes = 0;
  async function* records() {
    for (const name of before) {
      const path = join(rawDirectory, name), stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink());
      const hash = createHash("sha256"); let bytes = 0;
      yield JSON.stringify({ kind: "file", path: name, mode: stat.mode & 0o777, bytes: stat.size }) + "\n";
      for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
        bytes += chunk.length; totalRawBytes += chunk.length; assert.ok(totalRawBytes <= 2147483648);
        hash.update(chunk); yield JSON.stringify({ kind: "chunk", base64: chunk.toString("base64") }) + "\n";
      }
      assert.equal(bytes, stat.size);
      const row = { path: name, mode: stat.mode & 0o777, bytes, sha256: hash.digest("hex") }; entries.push(row);
      yield JSON.stringify({ kind: "end", ...row }) + "\n";
    }
  }
  const path = join(directory, "RAW.jsonl.gz");
  await pipeline(Readable.from(records()), createGzip({ level: 9 }), createWriteStream(path, { flags: "wx", mode: 0o644 })); flush(path);
  assert.deepEqual(readdirSync(rawDirectory).sort(), before, "raw append guard");
  for (const row of entries) assert.deepEqual(await fileHash(join(rawDirectory, row.path)), { bytes: row.bytes, sha256: row.sha256 });
  putJson(join(directory, "MANIFEST.json"), { schema: "expr-r21-n04-streamed-raw/1", commit, archive: { path: "RAW.jsonl.gz", ...await fileHash(path) }, totalRawBytes, entries });
}
export async function auditArchive() {
  if (!existsSync(join(directory, "MANIFEST.json"))) return { status: "unrun" };
  const manifest = json(join(directory, "MANIFEST.json"));
  assert.deepEqual(await fileHash(join(directory, manifest.archive.path)), { bytes: manifest.archive.bytes, sha256: manifest.archive.sha256 });
  const stream = createReadStream(join(directory, manifest.archive.path), { highWaterMark: 65536 }).pipe(createGunzip({ chunkSize: 65536 }));
  let incomplete = "", current, bytes = 0, total = 0, index = 0, hash;
  for await (const chunk of stream) {
    const lines = (incomplete + chunk.toString()).split("\n"); incomplete = lines.pop(); assert.ok(incomplete.length <= 100000);
    for (const line of lines) {
      assert.ok(line.length <= 100000); const row = JSON.parse(line);
      if (row.kind === "file") { assert.equal(current, undefined); current = row; bytes = 0; hash = createHash("sha256"); }
      else if (row.kind === "chunk") { assert.ok(current); const value = Buffer.from(row.base64, "base64"); assert.ok(value.length <= 65536); bytes += value.length; total += value.length; assert.ok(total <= 2147483648); hash.update(value); }
      else {
        assert.equal(row.kind, "end"); assert.equal(row.path, current.path); assert.equal(row.bytes, current.bytes); assert.equal(bytes, row.bytes); assert.equal(row.sha256, hash.digest("hex"));
        const { kind, ...entry } = row; assert.deepEqual(entry, manifest.entries[index++]); current = undefined;
      }
    }
  }
  assert.equal(current, undefined); assert.equal(incomplete, ""); assert.equal(index, manifest.entries.length); assert.equal(total, manifest.totalRawBytes);
  const report = json(join(directory, "REPORT.json"));
  let channelHashes = 0, moduleLoads = 0;
  for (const child of report.children) for (const channel of ["stdout", "stderr"]) {
    const output = child.output[channel], row = manifest.entries.find(value => value.path === `${child.name}.${channel}.raw`);
    assert.equal(row.bytes, output.bytes); assert.equal(row.sha256, output.sha256); channelHashes++;
  }
  const records = [...report.observations, ...report.controls.map(row => row.record).filter(Boolean)];
  for (const record of records) {
    const phase = record.receipt.startsWith("moved-") ? "moved" : "installed";
    const bindingPath = join(directory, "work/run-001/raw", `binding-${phase}.json`);
    const bindingBytes = read(bindingPath), bindingRow = manifest.entries.find(row => row.path === `binding-${phase}.json`);
    assert.equal(digest(bindingBytes), bindingRow.sha256);
    const binding = JSON.parse(bindingBytes);
    const raw = read(join(directory, "work/run-001/raw", `${record.receipt}.stderr.raw`));
    const loads = raw.toString().split("\n").filter(line => line.startsWith("EXPR_MAIN_LOAD ")).map(line => JSON.parse(line.slice(15)));
    assert.deepEqual(loads, record.actualLoads);
    for (const load of loads) { assert.equal(load.sha256, binding.expected[load.path]); moduleLoads++; }
  }
  return { status: "pass", rawEntries: index, rawBytes: total, channelHashes, actualMainLoadHashes: moduleLoads, observedWorkers: report.counts.workers, checks: report.checks.length, allChildrenClosed: report.allChildrenClosed,
    newEntryChecks: "consumer/tools per child; raw archive before/after; declared predecessor and recipe scopes PRE/POST; not a lease against arbitrary later append" };
}
export async function sealEvidence(commit, outer) {
  const optional = name => existsSync(join(directory, name)) ? json(join(directory, name)) : undefined;
  const report = optional("REPORT.json"), finalization = optional("FINALIZATION.json");
  let audit;
  try { audit = await auditArchive(); } catch (error) { audit = { status: "fail", error: error.stack }; }
  putJson(join(directory, "AUDIT.json"), audit);
  const qualified = outer.exitCode === 0 && report?.status === "TARGETED_QUALIFIED_ORIGINAL_HOLDS_UNCHANGED" && finalization?.status === "pass" && audit.status === "pass";
  const rows = report?.observations ?? [];
  put(join(directory, "REPORT.md"), `# R21/N04 reconciliation: ${qualified ? "targeted qualification only" : "HELD"}\n\nAuthorization August 28, 2026. Recipe ${commit}.\nRecipe manifest ${digest(read(join(directory, "RECIPE-SEAL.json")))}.\n\nOriginal v5 remains100/104 runtime and32/40 types; R21 is NOT rescored.\nP01 accepted v4 proof is BOUND, not rebuilt or repacked. Reader16/repair28/trace38 are reused, not replayed.\n\n## Actual counts\n\n${JSON.stringify(report?.counts ?? {}, null, 2)}\n\n## Independent R21 observations\n\n| Layout | Boundary | Original variant | Calls | Wrapper calls | Status | Diagnostic |\n|---|---|---|---:|---:|---:|---|\n${rows.map(row => `| ${row.label} | ${row.boundary} | ${row.variant === 0 ? "bad\\0arg" : "lone high surrogate D800"} | ${row.invocations} | ${row.wrapperInvocations} | ${row.result?.exitCode} | ${JSON.stringify(row.result?.diagnostic)} |`).join("\n")}\n\nNo native OS argv/NUL parity claim. Observation status is not the old fixture predicate.\n\n## N04 versioned amendment\n\nOnly N04 line11,column32 and its combined occurrence use TS2561 rather than TS2353. Exact field maxRegexSteps, type Partial<ExprLimits>, suggestion maxRegexStates and complete diagnostic bytes are mandatory. Other five combined diagnostics are unchanged. Sources, inputs, flags and original evidence are unchanged. New positive TRACE binding controls are separate from8 target outcomes. Forty wrong-receipt mutations are harness negatives, not synthetic product type passes.\n\n## Closure and integrity\n\nOuter natural=${outer.naturalSettlement}; childStatus=${outer.childStatus}; finalization=${finalization?.status}; audit=${audit.status}. Actual duration ${outer.startedAt} to ${outer.finishedAt}. No72-hour claim. Full raw receipts precede assertions and exit; package834/input/tool/hash/mode/new-entry guards and actual module-load receipts are retained.\n\n## Remaining holds\n\nOriginal R21 change requires a further root authorization; any public/direct amendment is a proposal only. Original v5 HOLD, accepted-DU gate HOLD, whole76/fullgate HOLD remain. No engine/TEMP/HTML/DU29/native/full104 replay.\n\n${(report?.failures ?? []).map(row => `- ${row.name}: ${row.error}`).join("\n")}\n`);
  const artifacts = [];
  for (const name of ["RECIPE-SEAL.json", "EXECUTION.raw.txt", "PRE-BINDINGS.json", "POST-BINDINGS.json", "REPORT.json", "REPORT.md", "FINALIZATION.json", "OUTER.json", "MANIFEST.json", "RAW.jsonl.gz", "AUDIT.json"]) if (existsSync(join(directory, name))) artifacts.push({ path: name, mode: lstatSync(join(directory, name)).mode & 0o777, ...await fileHash(join(directory, name)) });
  const seal = { schema: "expr-r21-n04-evidence/1", authorizationDate: "2026-08-28", recipeCommit: commit, recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), qualified,
    counts: report?.counts, P01: report?.P01, outer, audit, artifacts, holdsUnchanged: true, originalR21Rescored: false, newBuilds: 0 };
  putJson(join(directory, "EVIDENCE-SEAL.json"), seal); return seal;
}
