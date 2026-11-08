import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = "/Users/kjopek/Workspace/safe-bash";
const frozenRoot = join(repository, "tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92");
const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const record of pre.v9.records) assert.equal(hash(await readFile(join(frozenRoot, record.path))), record.sha256);
assert.equal(hash(await readFile(fileURLToPath(import.meta.url))), pre.reviewerFiles["run-once.mjs"]);
const { ProcessManager } = await import(pathToFileURL(join(frozenRoot, "harness/process-manager.mjs")));
const manager = new ProcessManager({ defaultTimeoutMs: 1_920_000, termGraceMs: 5_000, closureTimeoutMs: 10_000 });
manager.installSignalHandlers();
const resultDirectory = join(owned, "replay-once");
const temporary = join(owned, "temporary");
await writeFile(join(owned, "ONE-REPLAY-STARTED.json"), `${JSON.stringify({ reviewer: pre.reviewer, startedAt: new Date().toISOString(), freeze: pre.v9.revision, candidate: pre.candidate.commit, resultDirectory, supervisorSha256: pre.v9.records.find(record => record.path === "harness/process-manager.mjs").sha256, preSha256: hash(await readFile(join(owned, "PRE.json"))) }, null, 2)}\n`, { flag: "wx" });
await mkdir(temporary);
const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, npm_config_cache: join(temporary, "npm-cache"), npm_config_userconfig: "/dev/null", npm_config_update_notifier: "false", XDG_CACHE_HOME: join(temporary, "cache"), TSX_DISABLE_CACHE: "1" };
let result;
try {
  result = await manager.run(process.execPath, [join(frozenRoot, "replay.mjs"), pre.v9.revision, pre.candidate.commit, resultDirectory, pre.oracle.realpath], { cwd: repository, env });
  await writeFile(join(owned, "replay.stdout.data"), result.stdout, { flag: "wx" });
  await writeFile(join(owned, "replay.stderr.data"), result.stderr, { flag: "wx" });
} finally {
  const shutdown = await manager.shutdown("independent-one-replay-finished");
  const closure = manager.assertClosed();
  manager.removeSignalHandlers();
  const metadata = result && { ...result, stdout: { bytes: result.stdout.length, sha256: hash(result.stdout) }, stderr: { bytes: result.stderr.length, sha256: hash(result.stderr) } };
  await writeFile(join(owned, "ONE-REPLAY-SETTLED.json"), `${JSON.stringify({ result: metadata, shutdown, closure, environmentOverrides: Object.fromEntries(Object.entries(env).filter(([key]) => ["TMPDIR", "TMP", "TEMP", "npm_config_cache", "npm_config_userconfig", "npm_config_update_notifier", "XDG_CACHE_HOME", "TSX_DISABLE_CACHE"].includes(key))) }, null, 2)}\n`, { flag: "wx" });
}
process.stdout.write(`One replay settled: status=${result?.status}; timedOut=${result?.timedOut}; all owned groups closed.\n`);
process.exitCode = result?.status === 0 && !result?.timedOut ? 0 : 1;
