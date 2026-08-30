import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const runtimeCommit = "4c16d9c5a0e8661bc326a754205559a3e7ea6a32";
const callbackCommit = "01aa1bffe0568cc6787d5ff8e0331e024a787385";
const probe = fileURLToPath(new URL("../shell-stress/invocation-cleanup-runtime/public-worker.mjs", import.meta.url));
const frozenHashes: Readonly<Record<string, string>> = {
  "src/shell/cleanup.ts": "134f55641d6437681cd185960a2923d68086096921758717c5b8059595304385",
  "src/shell/runtime.ts": "2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b",
  "src/shell/shell.ts": "0e1d1396490970bf8db4d74ab07115d73e8303d29d7b748e145a06b13b316fee",
  "src/commands/grep.ts": "a5e93d8dd97c35f1a1530792b38478942647e6e66ac01fcd44fbea05fbfa78d1",
  "src/commands/search/rg.ts": "fee9a380679e17da179a1c6b4f9bacf9c89a10e0dd1d18981c26b9296f9846d3",
  "src/commands/regex-execution/client.ts": "1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca",
};
let snapshot: string | undefined;
let manifestPath: string;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function census(directory: string, base: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await census(path, base));
    else hashes[relative(base, path)] = digest(await readFile(path));
  }
  return hashes;
}

before(async () => {
  for (const [path, expected] of Object.entries(frozenHashes)) assert.equal(digest(await readFile(join(repository, path))), expected, `Live frozen source changed: ${path}`);
  snapshot = await realpath(await mkdtemp(join(tmpdir(), "safe-bash-invocation-public-")));
  const archive = spawnSync("git", ["archive", runtimeCommit, "--", "src", "package.json", "tsconfig.json", "tsconfig.build.json"], { cwd: repository, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(archive.error, undefined);
  assert.equal(archive.status, 0, archive.stderr.toString());
  const extraction = spawnSync("tar", ["-x", "-C", snapshot], { input: archive.stdout, timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(extraction.error, undefined);
  assert.equal(extraction.status, 0, extraction.stderr.toString());
  for (const [path, expected] of Object.entries(frozenHashes)) assert.equal(digest(await readFile(join(snapshot, path))), expected, `Snapshot source changed: ${path}`);
  await symlink(join(repository, "node_modules"), join(snapshot, "node_modules"), "dir");
  const build = spawnSync(process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "-p", join(snapshot, "tsconfig.build.json"), "--pretty", "false"], { cwd: snapshot, encoding: "utf8", timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(build.error, undefined);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const manifest = {
    runtimeCommit, callbackCommit, snapshot, node: process.version,
    sourceHashes: await census(join(snapshot, "src"), snapshot),
    emittedHashes: await census(join(snapshot, "dist"), snapshot),
    probeHash: digest(await readFile(probe)),
    packageHash: digest(await readFile(join(snapshot, "package.json"))),
    compilerVersion: JSON.parse(await readFile(join(repository, "node_modules/typescript/package.json"), "utf8")).version as string,
  };
  manifestPath = join(snapshot, "public-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  console.log(`PUBLIC_SOURCE_MANIFEST ${JSON.stringify(manifest)}`);
}, { timeout: 60000 });

after(async () => {
  if (snapshot) {
    const ownedSnapshot = snapshot;
    await rm(ownedSnapshot, { recursive: true, force: true });
    await assert.rejects(readFile(join(ownedSnapshot, "package.json")), { code: "ENOENT" });
    console.log(`PUBLIC_SNAPSHOT_CLEANUP ${JSON.stringify({ snapshot: ownedSnapshot, removed: true })}`);
  }
});

for (const command of ["grep", "rg"]) {
  for (const mode of ["normal", "early-pipe", "caller-abort", "same-shell-sibling", "other-shell-sibling"]) {
    test(`real registered ${command}: ${mode} waits owned native retirement`, { timeout: 15000 }, context => {
      assert.ok(snapshot);
      const scenario = `${command}:${mode}`;
      const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", probe, manifestPath, scenario], {
        cwd: snapshot, encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
      });
      const proof = { scenario, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
      context.diagnostic(JSON.stringify(proof));
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
