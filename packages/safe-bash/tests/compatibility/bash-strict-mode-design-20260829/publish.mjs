import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const root = JSON.parse(fs.readFileSync(path.join(own, "CAPTURE.json"))).root;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const start = JSON.parse(fs.readFileSync(path.join(root, "START.json")));
const records = [];
try {
  const elapsedMs = Date.now() - Date.parse(start.started);
  assert.ok(elapsedMs < 20 * 60 * 1000, "preparation deadline exceeded");
  function walk(directory, relative = "") {
    for (const name of fs.readdirSync(directory).sort()) {
      assert.notEqual(name, "AGENTS.md");
      const filename = path.join(directory, name), member = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(filename, member);
      else {
        assert.ok(stat.isFile() && stat.size <= 4 * 1024 * 1024);
        const bytes = fs.readFileSync(filename);
        records.push({ path: member, bytes: bytes.length, sha256: hash(bytes), dataBase64: bytes.toString("base64") });
      }
    }
  }
  walk(root);
  const bindingBytes = fs.readFileSync(path.join(root, "BINDING.json"));
  const binding = JSON.parse(bindingBytes);
  for (const row of binding.selected) {
    const found = records.find(record => record.path === `${row.path}.data`);
    assert.equal(found?.sha256, row.sha256);
  }
  const casesBytes = fs.readFileSync(path.join(own, "CASES.json"));
  const cases = JSON.parse(casesBytes);
  assert.equal(cases.cases.length, 50);
  assert.equal(new Set(cases.cases.map(row => row.id)).size, 50);
  assert.equal(cases.expectedRuntimeForEveryCase, null);
  assert.equal(cases.cases.filter(row => typeof row.program === "string").length, 44);
  assert.equal(cases.cases.filter(row => typeof row.protocol === "string").length, 6);
  assert.ok(cases.cases.every(row => row.program === undefined || Buffer.byteLength(row.program) < 1024));
  const totalBytes = records.reduce((total, row) => total + row.bytes, 0);
  assert.ok(totalBytes < 4 * 1024 * 1024);
  const capsule = gzipSync(Buffer.from(JSON.stringify({ role: "SOURCE_DATA_PREPARATION_ONLY", records })));
  fs.writeFileSync(path.join(own, "source-captures.json.gz"), capsule, { flag: "wx" });
  fs.writeFileSync(path.join(own, "BINDING.json"), bindingBytes, { flag: "wx" });
  const receipt = {
    role: "SOURCE_DATA_DESIGN_NOT_RUNTIME_VALIDATION", date: "2026-08-29",
    started: start.started, published: new Date().toISOString(), elapsedMs,
    candidate: binding.candidate, selectedFiles: binding.selected.length,
    cases: { literal: 44, hostProtocols: 6, totalIdentities: 50, executed: 0 },
    sourceCapture: { records: records.length, originalBytes: totalBytes, compressedBytes: capsule.length, sha256: hash(capsule) },
    casesSha256: hash(casesBytes), bindingSha256: hash(bindingBytes),
    sourceHelperErrors: records.filter(row => row.path.startsWith("ERROR-")).map(({ path: member, sha256 }) => ({ path: member, sha256 })),
    errorQualification: "Two malformed JSON regex request arguments failed before source reads; complete errors retained, corrected requests captured. UI truncation is not raw-capture truncation. No runtime failure or pass inferred.",
    execution: { product: 0, native: 0, compiler: 0, build: 0, install: 0, workers: 0, privateEngine: 0 },
    developmentGit: binding.children,
    processQualification: "Synchronous preparation helpers/tool calls returned, no ongoing sessions or product children. Four admission Git children have explicit code0/signal-null captures. Not a kernel descendant census or resource-lifecycle product proof.",
    retainedCaptureRoot: root,
    webQualification: "Official GNU5.3 manual search excerpts only; no authenticated GNU implementation body or local native version execution. References/unknowns in REFERENCES.md."
  };
  fs.writeFileSync(path.join(own, "PREPARATION.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(receipt));
} catch (error) {
  fs.writeFileSync(path.join(root, `PUBLICATION-ERROR-${Date.now()}.json`), JSON.stringify({ error: String(error), stack: error?.stack }), { flag: "wx" });
  throw error;
}
