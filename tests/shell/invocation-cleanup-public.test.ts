import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { preparePublicSnapshot, type CommittedInputs } from "../shell-stress/invocation-cleanup-runtime/migration/binding.js";

const repository = fileURLToPath(new URL("../../", import.meta.url));
let binding: Awaited<ReturnType<typeof preparePublicSnapshot>> | undefined;
let snapshot: string | undefined;
let manifestPath: string;
let probe: string;

before(async () => {
  const expectedPath = process.env.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED;
  const committedSource = process.env.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT;
  assert.equal(Boolean(expectedPath), Boolean(committedSource), "Committed qualification requires both explicit commit and independently captured expectation");
  const expected = expectedPath ? JSON.parse(await readFile(expectedPath, "utf8")) as CommittedInputs : undefined;
  if (expectedPath) {
    assert.ok(expected && typeof expected === "object" && !Array.isArray(expected), "Committed qualification requires an object manifest");
    assert.equal(expected.revision, committedSource);
  }
  binding = await preparePublicSnapshot(repository, expected);
  ({ snapshot, manifestPath, probe } = binding);
  console.log(`PUBLIC_SOURCE_MANIFEST ${JSON.stringify(binding.manifest)}`);
}, { timeout: 60000 });

after(async () => {
  if (binding) {
    try { await binding.verify(); }
    finally {
      await binding.dispose();
      console.log(`PUBLIC_SNAPSHOT_CLEANUP ${JSON.stringify({ snapshot, removed: true })}`);
    }
  }
});

for (const command of ["grep", "rg"]) {
  for (const mode of ["normal", "early-pipe", "caller-abort", "same-shell-sibling", "other-shell-sibling"]) {
    test(`real registered ${command}: ${mode} waits owned native retirement`, { timeout: 15000 }, async context => {
      assert.ok(snapshot);
      assert.ok(binding);
      await binding.verify();
      const scenario = `${command}:${mode}`;
      const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", probe, manifestPath, scenario], {
        cwd: snapshot, encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
      });
      const proof = { scenario, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
      context.diagnostic(JSON.stringify(proof));
      await binding.verify();
      assert.equal(result.error, undefined, `${scenario}: ${result.error?.message}`);
      assert.equal(result.signal, null, `${scenario}: ${result.stderr}`);
      assert.equal(result.status, 0, `${scenario}: ${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout.trim()) as { passed: boolean; sourcePinned: boolean; liveWorkers: number; unhandled: unknown[] };
      assert.equal(report.passed, true);
      assert.equal(report.sourcePinned, true);
      assert.equal(report.liveWorkers, 0);
      assert.deepEqual(report.unhandled, []);
    });
  }
}
