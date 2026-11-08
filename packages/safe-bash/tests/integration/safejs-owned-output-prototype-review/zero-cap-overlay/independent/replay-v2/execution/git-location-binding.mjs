import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";

const directory = dirname(fileURLToPath(import.meta.url));
const bindings = JSON.parse(readFileSync(join(directory, "BINDINGS.json"), "utf8"));
const repository = "/Users/kjopek/Workspace/safe-bash";
const snapshot = realpathSync(bindings.authorRoot);
assert.equal(snapshot, bindings.authorRoot);
const snapshotPrefix = relative(repository, snapshot) + "/";
const gitPrefix = relative(repository, bindings.authorGitRoot) + "/";
const names = new Set(bindings.authorFiles.map(entry => entry.path));
assert.equal(names.size, 88);
const logfile = resolve(process.env.ZERO_OVERLAY_GIT_BINDING_LOG);
assert.ok(bindings.cohorts.some(cohort => logfile === join(bindings.outputRoot, `independent-${cohort}`, "git-bindings.ndjson")));
const original = childProcess.execFileSync;
let mappings = 0;

childProcess.execFileSync = function (filename, args, ...options) {
  if (filename !== "/usr/bin/git" || !Array.isArray(args)) return Reflect.apply(original, this, [filename, args, ...options]);
  const publicRepository = args[0] === "-C" && args[1] === repository;
  const hasSnapshotPath = args.some(value => typeof value === "string" && value.includes(snapshotPrefix));
  if (!hasSnapshotPath) return Reflect.apply(original, this, [filename, args, ...options]);
  assert.ok(publicRepository, "Only the exact public repository Git lookup may be rebound");
  assert.deepEqual(args.slice(0, 4), ["-C", repository, "-c", "core.fsmonitor=false"]);
  const command = args.slice(4);
  let entry;
  let mapped;
  if (command[0] === "log") {
    assert.deepEqual(command, ["log", "-1", "--format=%H", "--", snapshotPrefix + "FREEZE.json"]);
    entry = "FREEZE.json";
    mapped = [...args.slice(0, 4), "log", "-1", "--format=%H", "--", gitPrefix + entry];
  } else {
    assert.equal(command.length, 2);
    assert.equal(command[0], "show");
    const prefix = bindings.authorFreezeCommit + ":" + snapshotPrefix;
    assert.ok(command[1].startsWith(prefix));
    entry = command[1].slice(prefix.length);
    assert.ok(names.has(entry), "Unlisted snapshot entry is never a Git input");
    mapped = [...args.slice(0, 4), "show", bindings.authorFreezeCommit + ":" + gitPrefix + entry];
  }
  mappings += 1;
  assert.ok(mappings <= 4096, "Bounded parent-only Git identity translations");
  appendFileSync(logfile, JSON.stringify({ sequence: mappings, entry, originalArgs: args, mappedArgs: mapped,
    authorFreezeCommit: bindings.authorFreezeCommit, parentPid: process.pid }) + "\n");
  return Reflect.apply(original, this, [filename, mapped, ...options]);
};
syncBuiltinESMExports();
