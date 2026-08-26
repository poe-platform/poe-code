import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { localSkip } from "../safejs/local-runtime.js";

test("desired action-abort observes original host rejection without hiding abort", { skip: localSkip }, () => {
  const temporary = mkdtempSync(join(tmpdir(), "safejs-action-abort-"));
  try {
    const child = spawnSync(process.execPath, [
      "--unhandled-rejections=strict", "--max-old-space-size=256", "--import", import.meta.resolve("tsx"),
      "--import", fileURLToPath(new URL("./import-proof.mjs", import.meta.url)),
      fileURLToPath(new URL("./action-abort.child.mjs", import.meta.url)),
    ], {
      cwd: temporary,
      env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, XDG_CACHE_HOME: temporary, TSX_DISABLE_CACHE: "1" },
      encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /outward abort observed/);
    assert.match(child.stdout, /completed without unhandled rejection/);
    assert.match(child.stdout, /actualEngineLoad.*\/src\/run.ts/);
    assert.match(child.stdout, /actualEngineLoad.*\/src\/interp\/interpreter.ts/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
