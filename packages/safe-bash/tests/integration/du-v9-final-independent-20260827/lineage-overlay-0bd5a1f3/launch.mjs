import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { owned, repository, freeze, candidate, frozenPath, overlayPath, hash, save, record, identifiers, exactBytes } from "./common.mjs";

const mode = process.argv[2];
assert(["controls", "replay"].includes(mode));
const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
const support = await import("./adapter-support.mjs");
await support.admitAdapter(freeze, candidate);
const managerPath = join(repository, frozenPath, "harness/process-manager.mjs");
exactBytes(await readFile(managerPath), pre.base.records.find(entry => entry.path === "harness/process-manager.mjs"), "supervisor before import");
const { ProcessManager } = await import(pathToFileURL(managerPath));
const manager = new ProcessManager({ defaultTimeoutMs: 1_920_000, termGraceMs: 5_000, closureTimeoutMs: 10_000 });
manager.installSignalHandlers();
const temporary = join(owned, "temporary");
await mkdir(temporary, { recursive: true });
const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, npm_config_cache: join(temporary, "npm-cache"), npm_config_userconfig: "/dev/null", npm_config_update_notifier: "false", XDG_CACHE_HOME: join(temporary, "cache"), TSX_DISABLE_CACHE: "1" };
let result;
try {
  if (mode === "controls") {
    const checks = [];
    for (const [name, action, expected] of [
      ["wrong-base", () => identifiers(candidate, candidate), /wrong base revision/u],
      ["wrong-candidate", () => identifiers(freeze, freeze), /wrong candidate revision/u],
      ["wrong-patch", () => support.validatePatch(Buffer.from("not the declared patch")), /patch bytes do not match/u],
      ["tampered-patched-harness", () => support.validateInventory([pre.delta.changedFile.overlay, ...pre.delta.untouchedFiles].map(entry => entry.path === "harness/verify-v5.mjs" ? { ...entry, sha256: "0".repeat(64) } : entry), "overlay"), /complete inventory mismatch/u],
      ["tampered-untouched-file", () => support.validateInventory([pre.delta.changedFile.overlay, ...pre.delta.untouchedFiles].map(entry => entry.path === "CASE_MAP.md" ? { ...entry, sha256: "0".repeat(64) } : entry), "overlay"), /complete inventory mismatch/u],
    ]) {
      assert.throws(action, expected);
      checks.push({ name, rejected: true, actualProductCases: 0, writesByGuard: 0 });
    }
    await save("ADAPTER-NEGATIVE-CONTROLS.json", { scope: "actual adapter pure-admission functions with intentionally invalid inputs, not candidate cases", checks });
    result = await manager.run(process.execPath, [join(repository, overlayPath, "focused-controls.mjs")], { cwd: repository, env, timeoutMs: 120_000 });
    await save("focused.stdout.data", result.stdout);
    await save("focused.stderr.data", result.stderr);
    assert.equal(result.status, 0);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.checks.length, 15);
    assert(receipt.checks.every(check => check.status === "ok"));
    await save("CONTROLS-ACCEPTED.json", { authorFocusedReexecuted: 15, adapterAdmissionNegatives: checks.length, productCasesRun: 0, receiptSha256: hash(result.stdout) });
  } else {
    const controls = JSON.parse(await readFile(join(owned, "CONTROLS-ACCEPTED.json")));
    assert.equal(controls.authorFocusedReexecuted, 15);
    const resultDirectory = join(owned, "replay-once");
    await save("ONE-REPLAY-STARTED.json", { at: new Date().toISOString(), freeze, candidate, overlay: pre.overlay.commit, executionPreSha256: hash(await readFile(join(owned, "EXECUTION-PRE.json"))), resultDirectory, attempts: 1 });
    result = await manager.run(process.execPath, [join(owned, "replay-adapter.mjs"), freeze, candidate, resultDirectory, pre.delta ? JSON.parse(await readFile(join(owned, "PRE-TOOLS.json"))).oracle.realpath : ""], { cwd: repository, env });
    await save("replay.stdout.data", result.stdout);
    await save("replay.stderr.data", result.stderr);
  }
} finally {
  const shutdown = await manager.shutdown(`${mode}-settled`);
  const closure = manager.assertClosed();
  manager.removeSignalHandlers();
  await save(`${mode}-SETTLED.json`, { result: result && { ...result, stdout: record("stdout", result.stdout), stderr: record("stderr", result.stderr) }, shutdown, closure, environmentOverrides: { TMPDIR: temporary, TSX_DISABLE_CACHE: "1", npmCache: env.npm_config_cache } });
}
process.stdout.write(`${mode}: status=${result?.status}; timedOut=${result?.timedOut}; owned groups closed.\n`);
process.exitCode = result?.status === 0 && !result?.timedOut ? 0 : 1;
