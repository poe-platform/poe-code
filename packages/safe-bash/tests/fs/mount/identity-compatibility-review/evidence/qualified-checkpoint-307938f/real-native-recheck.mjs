import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = dirname(fileURLToPath(import.meta.url));
const owned = resolve(output, "../..");
const repository = resolve(owned, "../../../..");
const manifest = JSON.parse(await readFile(join(output, "manifest-before.json"), "utf8"));
const archive = join(output, "source-307938f.tar.gz");
const hash = value => createHash("sha256").update(value).digest("hex");
assert.equal(hash(await readFile(archive)), manifest.archiveSha256);
await mkdir(join(owned, ".runs"), { recursive: true });
const scratch = await mkdtemp(join(owned, ".runs", "same-archive-real-"));
const nativeRoot = await mkdtemp("/tmp/sb-real-");
const tests = manifest.groups.real.filter(path => !path.includes("/metadata-review/"));
const excluded = manifest.groups.real.filter(path => !tests.includes(path));
assert.deepEqual(excluded, ["tests/fs/real/metadata-review/classification.test.ts"]);
const audit = { revision: manifest.revision, archiveSha256: manifest.archiveSha256, sourceSetSha256: manifest.sourceSetSha256, tests, excludedHistoricalArtifactReader: excluded, sourceOrTestEdits: [], nativeRootCreatedByThisLeaf: nativeRoot, scratch, startedAt: new Date().toISOString() };

try {
  execFileSync("tar", ["-xzf", archive, "-C", scratch]);
  await symlink(join(repository, "node_modules"), join(scratch, "node_modules"), "dir");
  for (const [path, expected] of Object.entries(manifest.inputHashes)) assert.equal(hash(await readFile(join(scratch, path))), expected, path);
  const command = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", ...tests];
  const result = spawnSync(process.execPath, command, { cwd: scratch, env: { ...process.env, TMPDIR: nativeRoot, TMP: nativeRoot, TEMP: nativeRoot }, encoding: "utf8", detached: true, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  let residualGroup = false;
  try { process.kill(-result.pid, 0); residualGroup = true; process.kill(-result.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  await writeFile(join(output, "backend-real-native-recheck.stdout"), result.stdout ?? "");
  await writeFile(join(output, "backend-real-native-recheck.stderr"), result.stderr ?? "");
  Object.assign(audit, { command: ["node", ...command], pid: result.pid, code: result.status, signal: result.signal, residualGroup, launchError: result.error?.message ?? null,
    counts: Object.fromEntries(["tests", "pass", "fail", "skipped", "todo", "cancelled"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(result.stdout ?? "")?.[1] ?? -1)])) });
  for (const [path, expected] of Object.entries(manifest.inputHashes)) assert.equal(hash(await readFile(join(scratch, path))), expected, path);
  audit.inputsStable = true;
  process.exitCode = result.status === 0 && !residualGroup ? 0 : 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
  await rm(nativeRoot, { recursive: true, force: true });
  Object.assign(audit, { finishedAt: new Date().toISOString(), scratchRemoved: true, ownedNativeRootRemoved: true, noUnownedPathsDeleted: true });
  await writeFile(join(output, "backend-real-native-recheck.json"), `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify(audit, null, 2));
}
