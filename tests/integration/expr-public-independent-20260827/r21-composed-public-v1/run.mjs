import assert from "node:assert/strict";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { directory, repository, owner, candidate, read, json, digest, inventory, put, putJson } from "./common.mjs";
import { inputs, previous, guardRecipe, tools } from "./auth.mjs";
import { supervise } from "./transport.mjs";
import { targetIds, validIds, mutations, validate } from "./validator.mjs";

const harness = ["child.mjs", "guard.mjs", "guard-negative.mjs", "observer.mjs", "worker-guard.mjs", "silent-worker.mjs", "cases.json"];
const labels = ["installed-node22", "installed-node24", "moved-node22", "moved-node24"];
function members(packBytes) {
  assert.equal(packBytes.length, 727526); assert.equal(digest(packBytes), "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd");
  const tar = gunzipSync(packBytes, { maxOutputLength: 16777216 }), rows = [], names = new Set();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/su, "");
    const prefix = text(345, 155), name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
    assert.ok(name.startsWith("package/")); const path = name.slice(8);
    assert.ok(path && !path.split("/").some(part => ["..", ".", "", "AGENTS.md"].includes(part)));
    assert.ok(!names.has(path)); names.add(path); assert.ok([0, 48].includes(header[156]));
    const size = Number.parseInt(text(124, 12).trim(), 8), mode = Number.parseInt(text(100, 8).trim(), 8) & 0o777;
    assert.equal(header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0), Number.parseInt(text(148, 8).trim(), 8));
    const bytes = Buffer.from(tar.subarray(offset + 512, offset + 512 + size)); assert.equal(bytes.length, size);
    rows.push({ path, bytes, mode, sha256: digest(bytes) }); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(rows.length, 834); assert.deepEqual(Object.fromEntries(rows.map(row => [row.path, row.sha256])), inputs.packageFiles);
  return rows;
}
export async function execute(commit, proof) {
  const runDirectory = join(directory, "work/run-001"), rawDirectory = join(runDirectory, "raw");
  mkdirSync(rawDirectory, { recursive: true });
  const report = { schema: "expr-r21-composed-target/1", authorizationDate: "2026-08-28", commit, candidate, startedAt: new Date().toISOString(), targets: [], controls: [], children: [], checks: [], failures: [], held: false };
  const save = (name, value) => putJson(join(rawDirectory, `${name}.json`), value);
  let consumer = join(runDirectory, "installed/consumer"), baseline, expected;
  const installed = consumer, moved = join(runDirectory, "moved package with spaces/consumer");
  const original = proof.bindings.originalR21;
  function protect(name) {
    try {
      guardRecipe();
      for (const tool of tools) assert.equal(digest(read(tool.path)), tool.sha256);
      assert.deepEqual(inventory(consumer), baseline, "complete consumer hash/mode/new-entry guard");
      if (consumer === moved) assert.equal(existsSync(installed), false);
      report.checks.push({ name, status: "pass", newEntries: true });
    } catch (error) { report.held = true; throw error; }
  }
  function bind(phase) {
    expected = Object.fromEntries(inventory(consumer).filter(row => row.kind === "file").map(row => [join(consumer, row.path), row.sha256]));
    const binding = { candidate, commit, expected, forbiddenSource: pathToFileURL(join(repository, "src/commands/expr/index.ts")).href };
    putJson(join(consumer, "binding.json"), binding); save(`binding-${phase}`, binding);
    baseline = inventory(consumer); save(`consumer-${phase}-before`, baseline);
  }
  function fail(name, error) { report.failures.push({ name, error: error.stack }); }
  async function control(name, action) {
    try { const result = await action(); report.controls.push({ id: name, status: "pass", ...result }); return true; }
    catch (error) { report.controls.push({ id: name, status: "fail", error: error.stack }); fail(name, error); return false; }
  }
  async function child(label, runtime, id) {
    assert.equal(report.held, false, "closed dependent admission");
    const name = `${label}-${id}`;
    protect(`${name}-pre`);
    const args = ["--permission", `--allow-fs-read=${consumer}`, "--allow-worker", "--import", join(consumer, "guard.mjs"), join(consumer, id === "source-fallback-guard" ? "guard-negative.mjs" : "child.mjs"), id];
    const receipt = await supervise({ name, executable: runtime.executable, executableSha256: runtime.sha256, args, cwd: consumer, home: runDirectory, rawDirectory,
      prelaunch: [...harness.map(path => join(consumer, path)), join(consumer, "binding.json"), join(directory, "RECIPE-SEAL.json"), join(directory, "run.mjs"), join(directory, "validator.mjs")] });
    report.children.push(receipt);
    protect(`${name}-post`);
    let record, actualLoads;
    try {
      assert.equal(receipt.closed, true); assert.equal(receipt.naturalSettlement, true); assert.equal(receipt.artifactCompleteness, "full-observed-child-streams");
      for (const output of Object.values(receipt.output)) { const bytes = read(output.path); assert.equal(bytes.length, output.bytes); assert.equal(digest(bytes), output.sha256); }
      record = JSON.parse(receipt.stdout.trim());
      actualLoads = receipt.stderr.split("\n").filter(line => line.startsWith("EXPR_MAIN_LOAD ")).map(line => JSON.parse(line.slice(15)));
      assert.ok(actualLoads.length > 0);
      for (const load of actualLoads) assert.equal(load.sha256, expected[load.path], load.path);
      if (id !== "source-fallback-guard") {
        assert.equal(record.cleanupSettled, true); assert.ok(record.observer.workers.every(worker => worker.closed));
        assert.ok(!/EXPR_DENY|EXPR_RESOLVE_ERROR/u.test(receipt.stderr));
        for (const suffix of ["dist/index.js", "dist/commands/expr/index.js", "dist/shell/runtime.js"]) assert.ok(actualLoads.some(load => load.path === join(consumer, "node_modules/virtual-bash", suffix)));
      } else {
        assert.match(receipt.stderr, /EXPR_DENY/u);
        assert.equal(record.forbiddenSource, pathToFileURL(join(repository, "src/commands/expr/index.ts")).href);
      }
    } catch (error) { report.held = true; throw error; }
    assert.equal(receipt.status, 0, receipt.stderr.slice(-2000));
    return { ...record, actualLoads, receipt: name, label };
  }
  try {
    for (const row of members(proof.packBytes)) put(join(consumer, "node_modules/virtual-bash", row.path), row.bytes, row.mode);
    const metadata = json(join(consumer, "node_modules/virtual-bash/package.json")); assert.equal(metadata.name, "virtual-bash"); assert.deepEqual(metadata.dependencies ?? {}, {});
    for (const path of harness) put(join(consumer, path), read(join(path === "child.mjs" ? directory : previous, path)));
    putJson(join(consumer, "package.json"), { private: true, type: "module" });
    bind("installed");
    for (const [index, label] of labels.entries()) {
      if (report.held) break;
      if (index === 2) {
        protect("before-physical-move"); mkdirSync(join(runDirectory, "moved package with spaces")); renameSync(consumer, moved); consumer = moved;
        assert.equal(existsSync(installed), false); assert.deepEqual(inventory(consumer), baseline);
        renameSync(join(consumer, "binding.json"), join(consumer, "installed-binding.json")); bind("moved"); protect("after-physical-move");
      }
      const runtime = inputs.runtimes[index % 2];
      for (const id of validIds) if (!await control(`${label}-${id}`, async () => {
        const record = await child(label, runtime, id); validate(record, { id, original, consumer, packageFiles: inputs.packageFiles, expected }); return { record, kind: "actual-valid-dispatch" };
      })) report.held = true;
      if (!await control(`${label}-source-fallback-guard`, async () => {
        const record = await child(label, runtime, "source-fallback-guard"); assert.equal(record.status, "pass"); return { record, kind: "actual-loader-guard" };
      })) report.held = true;
      for (const id of targetIds) {
        if (report.held) break;
        try {
          const record = await child(label, runtime, id), spec = { id, original, consumer, packageFiles: inputs.packageFiles, expected };
          save(`${label}-${id}-record`, record);
          validate(record, spec); report.targets.push({ label, id, status: "pass", record });
          if (index === 0) {
            const qualified = await control(`validator-${id}-positive`, async () => { save(`validator-${id}-positive`, { record, receipt: record.receipt, shouldReject: false }); validate(record, spec); return { kind: "actual-target-receipt-validator-positive" }; });
            if (!qualified) report.held = true;
            if (qualified) for (const [mutation, change] of mutations) if (!await control(`validator-${id}-${mutation}`, async () => {
              const altered = structuredClone(record); change(altered);
              save(`validator-${id}-${mutation}`, { record: altered, receipt: record.receipt, shouldReject: true });
              assert.throws(() => validate(altered, spec)); return { kind: "harness-negative-not-product" };
            })) report.held = true;
          }
        } catch (error) { report.targets.push({ label, id, status: "fail", error: error.stack }); fail(`${label}-${id}`, error); }
      }
      console.log(JSON.stringify({ phase: label, targets: report.targets.length, controls: report.controls.length, held: report.held, failures: report.failures.length }));
    }
  } catch (error) { report.held = true; fail("admission-or-integrity", error); }
  finally {
    if (baseline) try { protect("final-consumer"); } catch (error) { fail("final-consumer", error); }
    report.finishedAt = new Date().toISOString();
    report.counts = { targets: report.targets.length, targetPass: report.targets.filter(row => row.status === "pass").length, targetFail: report.targets.filter(row => row.status === "fail").length,
      targetUnrun: 16 - report.targets.length, controls: report.controls.length, controlsPass: report.controls.filter(row => row.status === "pass").length, controlsFail: report.controls.filter(row => row.status === "fail").length,
      controlsUnrun: 64 - report.controls.length, children: report.children.length, naturalChildren: report.children.filter(row => row.naturalSettlement && row.closed).length,
      forcedChildren: report.children.filter(row => !row.naturalSettlement).length, workers: [...report.targets.map(row => row.record), ...report.controls.map(row => row.record)].filter(Boolean).reduce((total, row) => total + (row.observer?.workers.length ?? 0), 0), checks: report.checks.length };
    report.status = !report.held && !report.failures.length && report.counts.targetPass === 16 && report.counts.controlsPass === 64 && report.counts.children === 28 && report.counts.naturalChildren === 28 ? "TARGETS_QUALIFIED" : "HELD";
    save("REPORT", report); putJson(join(directory, "REPORT.json"), report);
  }
  return report;
}
