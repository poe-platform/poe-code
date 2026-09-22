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

test("private checkout refuses qualification at its first unauthenticated prerequisite", { timeout: 300_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), "safe-bash-export-report-"));
  try {
    const reportPath = join(directory, "report.json");
    const revision = process.env.S3_HTTP_EXPORTS_REVISION ?? "HEAD";
    const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
    let expected = "Public SafeFS must preserve shared SafeJS runtime identity";
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./verify.mjs", import.meta.url)),
      revision, reportPath,
      ...(process.env.S3_HTTP_EXPORTS_PEER_ARTIFACT ? [process.env.S3_HTTP_EXPORTS_PEER_ARTIFACT] : []),
    ], { env: cleanEnvironment(directory), encoding: "utf8", timeout: 290_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.status, "fail");
    if (report.error.message.startsWith("Peer binding requires the selected committed ")) {
      for (const [path, prerequisite] of [
        ["packages/safe-bash/package.json", "package metadata"],
        ["package-lock.json", "workspace lock"],
        ["package.json", "root metadata"],
      ]) {
        const committed = spawnSync("git", ["show", `${revision}:${path}`], {
          cwd: repository, env: cleanEnvironment(directory), timeout: 2000, maxBuffer: 16 * 1024 * 1024,
        });
        assert.ifError(committed.error);
        assert.equal(committed.status, 0, committed.stderr.toString());
        if (!committed.stdout.equals(readFileSync(join(repository, path)))) {
          expected = `Peer binding requires the selected committed ${prerequisite}`;
          break;
        }
      }
    }
    assert.ok(report.error.message.startsWith(expected), report.error.message);
    assert.deepEqual(report.steps, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
