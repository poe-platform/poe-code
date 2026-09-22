import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

await import(new URL("./archive-controls.test.mjs", import.meta.url).href);
await import(new URL("./archive-parser.test.mjs", import.meta.url).href);
const { cleanEnvironment } = await import(new URL("./committed-archive.mjs", import.meta.url).href);

test("explicit committed shell qualification uses matching canonical peer outputs", { timeout: 300_000 }, (context) => {
  if (process.env.S3_HTTP_EXPORTS_REVISION === undefined) {
    context.skip("Live committed qualification requires an explicit revision and matching canonical peer outputs; see docs/plans/safe-bash-remote-media.md");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "safe-bash-export-report-"));
  try {
    const reportPath = join(directory, "report.json");
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./verify.mjs", import.meta.url)),
      process.env.S3_HTTP_EXPORTS_REVISION ?? "HEAD", reportPath,
      ...(process.env.S3_HTTP_EXPORTS_PEER_ARTIFACT ? [process.env.S3_HTTP_EXPORTS_PEER_ARTIFACT] : []),
    ], { env: cleanEnvironment(directory), encoding: "utf8", timeout: 290_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.status, "pass");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
