import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const output = "/tmp/redirection-author-5TPGGF", outer = "/tmp/bash-redirection-unit1-launch-nyjrUG";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let total = 0;
const records = [];
await fs.writeFile(path.join(outer, "publication-start.json"), JSON.stringify({ started: new Date().toISOString(), role: "DATA_ONLY_NO_PRODUCT_REPLAY" }), { flag: "wx" });
try {
  assert.deepEqual(process.argv.slice(2), ["--publish-retained"]);
  const source = JSON.parse(await fs.readFile(path.join(own, "SOURCE.json")));
  const receipt = JSON.parse(await fs.readFile(path.join(output, "RESULT.json")));
  assert.equal(receipt.source.computedTree, source.computedTree); assert.equal(receipt.status, "AUTHOR_ASSERTION_FAILURES");
  assert.equal(receipt.cleanup.allClosed, true); assert.equal(receipt.cleanup.signals.length, 0); assert.equal(receipt.cleanup.implicitLoaderReservations, 24);
  async function capture(root, name, prefix, maximum = 8 * 1024 * 1024) {
    assert.ok(!name.includes("/") && name !== "AGENTS.md");
    const filename = path.join(root, name), stat = await fs.lstat(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
    total += stat.size; assert.ok(total <= 64 * 1024 * 1024);
    const bytes = await fs.readFile(filename); assert.equal(bytes.length, stat.size);
    records.push({ path: prefix + "/" + name, bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString("base64") });
    return bytes;
  }
  const names = (await fs.readdir(output)).filter(name => /(?:\.stdout|\.stderr|\.jsonl|-binding\.json)$/.test(name) || ["RESULT.json", "SUMMARY-v1.json", receipt.package.file].includes(name)).sort();
  for (const name of names) await capture(output, name, "run");
  for (const name of ["START.json", "TERMINAL.json", "stdout", "stderr", "progress-1.json"]) await capture(outer, name, "outer");
  const preparation = JSON.parse(await fs.readFile(path.join(own, "PREPARATION-ROOT.json"))).root;
  for (const name of (await fs.readdir(preparation)).filter(name => /\.(json|nul)$/.test(name)).sort()) await capture(preparation, name, "preparation");
  const packageRecord = records.find(row => row.path === "run/" + receipt.package.file);
  assert.equal(packageRecord.sha256, "e0e63b0319f0b7b77e68a6e6284021bd747c60ce9f93291a5090048fa835e296");
  assert.equal(receipt.package.members.length, 950);
  const sourceRows = [];
  for (const row of source.inputs) {
    const filename = path.join(output, "source", row.path), stat = await fs.lstat(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes);
    const bytes = await fs.readFile(filename); assert.equal(sha(bytes), row.sha256); sourceRows.push({ path: row.path, sha256: row.sha256 });
  }
  const metadata = spawnSync("/usr/bin/git", ["log", "-1", "--format=%H", "1e9b83d7"], { encoding: "utf8", maxBuffer: 65536, timeout: 5000, env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } });
  assert.equal(metadata.status, 0); assert.equal(metadata.signal, null);
  const failures = receipt.failures.map(group => ({ label: group.label, cases: group.cases?.map(row => ({ id: row.id, error: row.error, class: "AUTHOR_DIRECTORY_ENTRY_SHAPE_ASSERTION", laterAssertionsMayBeUnreached: true })) }));
  const loads = records.filter(row => row.path.endsWith("-loads.jsonl")).map(row => {
    const entries = Buffer.from(row.base64, "base64").toString().trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    return { file: row.path, events: entries.length, distinctPaths: new Set(entries.map(entry => entry.file)).size };
  });
  const data = JSON.stringify({ role: "IMMUTABLE_AUTHOR_V1_RAW_WITH_ASSERTION_FAILURES", records });
  assert.ok(Buffer.byteLength(data) <= 96 * 1024 * 1024);
  const compressed = gzipSync(Buffer.from(data));
  const summary = { sourceCommit: metadata.stdout.trim(), candidateTree: source.computedTree, sourceSha256: sha(await fs.readFile(path.join(own, "SOURCE.json"))), sourceInputs: 292, sourcePostverified: sourceRows.length, productOverlay: source.overlay, package: { ...receipt.package, members: undefined, memberCount: receipt.package.members.length }, status: receipt.status, native: 0, private: 0, children: receipt.cleanup, outer: JSON.parse(await fs.readFile(path.join(outer, "TERMINAL.json"))), cohortSummary: receipt.cohorts.map(row => ({ label: row.label, cases: Array.isArray(row.cases) ? row.cases.length : row.cases, pass: row.pass, fail: row.fail ?? 0 })), types: receipt.types.map(row => ({ label: row.label, negative: row.negative, pass: row.pass, diagnostics: row.errors.length })), controls: receipt.controls, failures, loads, captureBytes: receipt.captureBytes, scratchBytes: receipt.actualScratchBytes, elapsedMs: receipt.elapsedMs, publicationRawBytes: total, rawCompressedSha256: sha(compressed), rawCompressedBytes: compressed.length, rawRecords: records.length, fixtureV2: { executed: 0, expectedNoProductChange: true }, noOverallAcceptance: true };
  await fs.mkdir(path.join(own, "results-v1"));
  for (const [name, bytes] of [["RAW.json.gz.base64", Buffer.from(compressed.toString("base64") + "\n")], ["SUMMARY.json", Buffer.from(JSON.stringify(summary, null, 2) + "\n")], ["PACKAGE-MEMBERS.json", Buffer.from(JSON.stringify(receipt.package.members, null, 2) + "\n")], ["RAW-INDEX.json", Buffer.from(JSON.stringify(records.map(({ base64, ...row }) => row), null, 2) + "\n")]]) await fs.writeFile(path.join(own, "results-v1", name), bytes, { flag: "wx" });
  const report = { sourceCommit: summary.sourceCommit, candidate: summary.candidateTree, package: summary.package.sha256, records: records.length, rawBytes: total, compressedBytes: compressed.length, elapsedMs: receipt.elapsedMs, rows: summary.cohortSummary, loadGroups: loads.length };
  await fs.writeFile(path.join(outer, "publication-result.json"), JSON.stringify(report, null, 2), { flag: "wx" }); console.log(JSON.stringify(report));
} catch (error) { await fs.writeFile(path.join(outer, "publication-error.json"), JSON.stringify({ error: String(error), stack: error.stack }), { flag: "wx" }); throw error; }
