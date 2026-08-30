import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

await import(new URL("./archive-controls.test.mjs", import.meta.url).href);
const { cleanEnvironment } = await import(new URL("./committed-archive.mjs", import.meta.url).href);

test("S3 HTTP root/subpath exports work from a clean packed revision without source fallback", { timeout: 300_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), "safe-bash-export-report-"));
  try {
    const reportPath = join(directory, "report.json");
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./verify.mjs", import.meta.url)),
      process.env.S3_HTTP_EXPORTS_REVISION ?? "HEAD", reportPath,
    ], { env: cleanEnvironment(directory), encoding: "utf8", timeout: 290_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.status, "pass");
    assert.equal(report.runtime.requests, 0);
    assert.equal(report.typecheck.sourceFallback, false);
    assert.deepEqual(report.typecheck.negativeDiagnosticCodes, [2322, 2345, 2741]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
