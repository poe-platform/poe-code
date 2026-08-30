import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
assert.equal(root, "/Users/kjopek/Workspace/safe-bash");
const sourceCommit = "84ab66ca717e0dff21abf57051b41cb553f3c7f3";
const testCommit = "1a18cb1858f9453f41a20caff0988c578aa9c7e2";
const output = path.join(directory, "canonical-replay.json");
assert.equal(fs.existsSync(output), false, "Never replace an existing capture");
const testPaths = [
  "tests/shell/env-split-native.test.ts",
  "tests/shell/env-split-host.test.ts",
  "tests/shell-stress/env-split-author/resume-fixtures.ts",
  "tests/shell-stress/env-split-author/resume-host.ts",
  "tests/shell-stress/env-split-author/native-frozen.json",
  "tests/shell-stress/env-split-author/resume-native.json",
  "tests/shell-stress/env-split-author/resume-cases.json",
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const command = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: root, timeout: 20000, maxBuffer: 32 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const git = (...args) => command("git", args);
const inventory = (revision, paths) => Object.fromEntries(git("ls-tree", "-r", "--name-only", revision, "--", ...paths).toString().trim().split("\n").map(name => [name, hash(git("show", `${revision}:${name}`))]));
const tools = Object.fromEntries([
  process.execPath,
  "node_modules/tsx/package.json",
  "node_modules/tsx/dist/loader.mjs",
  "node_modules/typescript/package.json",
  "node_modules/esbuild/package.json",
].map(name => [name, hash(fs.readFileSync(path.resolve(root, name)))]));
const sourceInventory = inventory(sourceCommit, ["src", "package.json", "tsconfig.json"]);
const testInventory = inventory(testCommit, testPaths);
assert.deepEqual(testInventory, inventory(sourceCommit, testPaths));
const guardPaths = [...Object.keys(sourceInventory).filter(name => name.startsWith("src/")), ...testPaths];
const liveBefore = Object.fromEntries(guardPaths.map(name => [name, hash(fs.readFileSync(path.join(root, name)))]));
const scratch = fs.mkdtempSync(path.join(directory, ".replay-"));
const record = {
  started: new Date().toISOString(), sourceCommit, testCommit,
  qualification: "Bounded classification replay only; not the independent sealed core verdict or a full gate",
  node: { path: process.execPath, version: process.version, platform: process.platform, arch: process.arch },
  tools, sourceInventory, testInventory, scratch,
  nativeExecutions: 0, dependencyInstalls: 0, existingFilesEdited: 0,
};
let child;
const killGroup = pid => { try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
try {
  const sourceArchive = git("archive", sourceCommit, "src", "package.json", "tsconfig.json");
  const testArchive = git("archive", testCommit, ...testPaths);
  record.archiveHashes = { source: hash(sourceArchive), tests: hash(testArchive) };
  command("tar", ["-xf", "-", "-C", scratch], { input: sourceArchive });
  command("tar", ["-xf", "-", "-C", scratch], { input: testArchive });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(scratch, "node_modules"), "dir");
  record.borrowedNodeModules = { path: path.join(root, "node_modules"), realpath: fs.realpathSync(path.join(scratch, "node_modules")) };
  const assertInputs = () => {
    for (const [name, expected] of Object.entries({ ...sourceInventory, ...testInventory })) assert.equal(hash(fs.readFileSync(path.join(scratch, name))), expected, name);
  };
  assertInputs();
  record.inputsBefore = true;
  const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...testPaths.slice(0, 2)];
  const environment = { PATH: "/usr/bin:/bin", HOME: scratch, TMPDIR: scratch, LC_ALL: "C", LANG: "C", TZ: "UTC", TSX_DISABLE_CACHE: "1" };
  record.command = { binary: process.execPath, args, cwd: scratch, env: environment, deadlineMs: 60000, byteLimit: 4 * 1024 * 1024 };
  record.result = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd: scratch, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, 60000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes <= 4 * 1024 * 1024) chunks.push(Buffer.from(chunk));
      else { overflow = true; killGroup(child.pid); }
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, status, signal, timedOut, overflow, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
  });
  assert.equal(record.result.timedOut, false);
  assert.equal(record.result.overflow, false);
  assert.equal(record.result.status, 0);
  assert.equal(record.result.signal, null);
  assert.equal(record.result.stderr, "");
  record.passedTestNames = [...record.result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
  assert.equal(record.passedTestNames.length, 89);
  assert.match(record.result.stdout, /^# tests 89$/m);
  assert.match(record.result.stdout, /^# fail 0$/m);
  assert.match(record.result.stdout, /^# skipped 0$/m);
  assert.match(record.result.stdout, /^# cancelled 0$/m);
  assert.match(record.result.stdout, /^# todo 0$/m);
  assertInputs();
  record.inputsAfter = true;
  record.completed = true;
} catch (error) {
  record.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (child?.pid) killGroup(child.pid);
  const processes = command("ps", ["-axo", "pid=,ppid=,pgid=,command="]).toString().split("\n");
  const remaining = processes.filter(line => line.includes(scratch) && /resume-host\.ts/.test(line));
  record.cleanup = { survivingHostCommands: remaining, hostReapingAssertions: record.passedTestNames?.filter(name => name.startsWith("env split bounded host:")).length ?? 0 };
  for (const line of remaining) killGroup(Number(line.trim().split(/\s+/)[2]));
  fs.rmSync(scratch, { recursive: true, force: true });
  record.cleanup.scratchAbsent = !fs.existsSync(scratch);
  record.liveGuardChanges = guardPaths.filter(name => hash(fs.readFileSync(path.join(root, name))) !== liveBefore[name]);
  record.toolChanges = Object.entries(tools).filter(([name, expected]) => hash(fs.readFileSync(path.resolve(root, name))) !== expected).map(([name]) => name);
  record.finished = new Date().toISOString();
  const content = JSON.stringify(record, null, 2) + "\n";
  command("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${path.relative(root, output)}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
}
assert.equal(record.cleanup.survivingHostCommands.length, 0);
assert.equal(record.cleanup.scratchAbsent, true);
assert.deepEqual(record.liveGuardChanges, []);
assert.deepEqual(record.toolChanges, []);
console.log(JSON.stringify({ completed: record.completed, tests: record.passedTestNames?.length, cleanup: record.cleanup, output }));
