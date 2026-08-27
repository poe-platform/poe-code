import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRealFileSystem } from "../../../../src/fs/real/index.js";
import { shellRun, trace } from "../helpers.js";
import { explicitDiagnostics, nativeCases } from "./native-cases.js";

test("actual rooted Real/Shell versus pinned GNU9.7 functional cases", async context => {
  const oracle = fileURLToPath(new URL("../../metadata-stress/.oracle/coreutils-9.7/src/du", import.meta.url));
  let binary: Uint8Array;
  try { binary = await readFile(oracle); }
  catch { context.skip("pinned GNU 9.7 binary unavailable; no BSD fallback"); return; }
  const expectedHash = "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b";
  assert.equal(createHash("sha256").update(binary).digest("hex"), expectedHash);
  const root = await mkdtemp(fileURLToPath(new URL(".native-live-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "file"), new Uint8Array(1025));
  const fs = await createRealFileSystem({ root });
  for (const item of nativeCases) {
    const native = spawnSync(oracle, item.args, { cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env }, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
    assert.equal(native.error, undefined);
    const checked = trace(fs); const result = await shellRun(checked.fs, item.args, { ...item.env });
    assert.equal(result.exitCode, native.status, item.id); assert.equal(result.stdout, native.stdout, item.id);
    assert.equal(result.stderr, explicitDiagnostics[item.id] ?? native.stderr, item.id);
    if (item.id.startsWith("explicit-invalid") || item.id === "empty-only") assert.equal(checked.calls.length, 0);
  }
  assert.equal(createHash("sha256").update(await readFile(oracle)).digest("hex"), expectedHash);
});
