import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const repository = "/Users/kjopek/Workspace/safe-bash";
export const owned = "tests/commands/diff-patch-stress/quiet-postfix-review";
export const location = "/tmp/safe-bash-quiet-postfix-review-location.txt";
export const statusPath = "/tmp/safe-bash-quiet-postfix-review-status.txt";
export const historical = "tests/commands/diff-patch-stress/gnu-followup-checkpoint";
export const guard = "tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/guard.mjs";
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const readJson = path => JSON.parse(readFileSync(path, "utf8"));
export function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
export function git(...args) {
  return execFileSync("git", args, { cwd: repository, maxBuffer: 128 * 1024 * 1024 });
}
export function inventory(root, paths) {
  const result = {};
  function visit(path) {
    const absolute = join(root, path), stat = lstatSync(absolute);
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) visit(join(path, name));
    else result[path] = stat.isSymbolicLink() ? { link: readlinkSync(absolute) } : { sha256: sha(readFileSync(absolute)), bytes: stat.size, mode: stat.mode & 0o777 };
  }
  for (const path of [...paths].sort()) visit(path);
  return result;
}
export function differences(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path])).map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
}
export function status(message) {
  writeFileSync(statusPath, `${new Date().toISOString()}\n${message}\nNo production, existing tests, benchmarks or historical evidence edited.\n`);
  console.log(message);
}
export function environment(work) {
  const env = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: join(work, "temporary"), TSX_DISABLE_CACHE: "1" };
  for (const name of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$|EXPANDED_)/u.test(name)) delete env[name];
  mkdirSync(env.TMPDIR, { recursive: true });
  return env;
}
export function execute(work, snapshot, name, args, guarded = true) {
  const directory = join(work, "logs");
  mkdirSync(directory, { recursive: true });
  const stdoutPath = join(directory, `${name}.stdout`), stderrPath = join(directory, `${name}.stderr`);
  const stdout = openSync(stdoutPath, "wx"), stderr = openSync(stderrPath, "wx");
  const env = environment(work);
  env.CHECKPOINT_SNAPSHOT = snapshot;
  env.CHECKPOINT_IMPORT_LOG = join(work, "imports", name);
  mkdirSync(env.CHECKPOINT_IMPORT_LOG, { recursive: true });
  const command = ["--unhandled-rejections=strict", ...(guarded ? ["--import", `./${guard}`] : []), ...args];
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, command, { cwd: snapshot, env, stdio: ["ignore", stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  const recordedEnv = Object.fromEntries(Object.entries(env).filter(([name]) => /^(?:PATH|LC_ALL|LANG|TZ|TMPDIR|TSX_DISABLE_CACHE|CHECKPOINT_SNAPSHOT|CHECKPOINT_IMPORT_LOG)$/u.test(name)));
  const record = { name, command: [process.execPath, ...command], cwd: snapshot, env: recordedEnv, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: { path: stdoutPath, sha256: sha(readFileSync(stdoutPath)) }, stderr: { path: stderrPath, sha256: sha(readFileSync(stderrPath)) } };
  save(join(directory, `${name}.execution.json`), record);
  assert.equal(result.signal, null, `worker did not close normally: ${name}`);
  assert.equal(record.error, null, name);
  return record;
}
