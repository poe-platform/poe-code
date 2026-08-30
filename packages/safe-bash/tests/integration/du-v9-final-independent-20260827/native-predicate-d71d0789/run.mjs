import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { owned, repository, basePath, bundlePath, overlay, hash, identity, save, inventory } from "./review.mjs";

const mode = process.argv[2];
assert(["controls", "native"].includes(mode));
const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
const execution = JSON.parse(await readFile(join(owned, "EXECUTION-PRE.json")));
for (const entry of execution.files) assert.deepEqual(identity(entry.path, await readFile(join(owned, entry.path))), entry);
for (const entry of Object.values(pre.tools)) assert.equal(hash(await readFile(entry.path)), entry.sha256);
for (const bound of [pre.base, pre.bundle]) assert.deepEqual(await inventory(join(repository, bound.root)), bound.records);
const expectedRuntime = JSON.parse(await readFile(join(owned, "RUNTIME-AFTER-PATCH.json"))).files;
assert.deepEqual(await inventory(join(owned, "runtime")), expectedRuntime);
const supervisor = join(owned, "runtime/harness/process-manager.mjs");
assert.deepEqual(identity(pre.supervisor.path, await readFile(supervisor)), pre.supervisor);
const { ProcessManager } = await import(pathToFileURL(supervisor));
const manager = new ProcessManager({ defaultTimeoutMs: 120_000, termGraceMs: 750, closureTimeoutMs: 2_500 });
manager.installSignalHandlers();
const temporary = join(owned, "temporary");
await mkdir(temporary, { recursive: true });
const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary };
let result;
try {
  if (mode === "controls") {
    await save("FOCUSED-STARTED.json", { at: new Date().toISOString(), overlay, nativeRowsExecuted: 0 });
    result = await manager.run(process.execPath, [join(repository, bundlePath, "focused-predicate-controls.mjs")], { cwd: repository, env });
  } else {
    const controls = JSON.parse(await readFile(join(owned, "controls.stdout.data")));
    assert.equal(controls.passed, 14);
    assert.equal(controls.total, 14);
    assert.equal(JSON.parse(await readFile(join(owned, "controls-SETTLED.json"))).result.status, 0);
    await save("ONE-NATIVE-STARTED.json", { at: new Date().toISOString(), overlay, executionBindingSha256: hash(await readFile(join(owned, "EXECUTION-PRE.json"))), cases: 16, attempts: 1, sourcePackageOrFullRecipeAuthorized: false });
    result = await manager.run(process.execPath, [join(owned, "runtime/native-env.mjs"), pre.tools.native.path, join(owned, "native-table.json"), join(owned, "native-scratch")], { cwd: repository, env });
  }
  await save(`${mode}.stdout.data`, result.stdout);
  await save(`${mode}.stderr.data`, result.stderr);
} finally {
  const shutdown = await manager.shutdown(`${mode}-finished`);
  const closure = manager.assertClosed();
  manager.removeSignalHandlers();
  await save(`${mode}-SETTLED.json`, { result: result && { ...result, stdout: identity("stdout", result.stdout), stderr: identity("stderr", result.stderr) }, shutdown, closure, parentTemporaryOverrides: { TMPDIR: temporary, TMP: temporary, TEMP: temporary }, nativeCaseEnvironment: "unchanged: driver constructs exact frozen sanitized environment for each native spawn" });
}
process.stdout.write(`${mode}: status=${result?.status}; timeout=${result?.timedOut}; root/group closed.\n`);
process.exitCode = result?.status === 0 && !result?.timedOut ? 0 : 1;
