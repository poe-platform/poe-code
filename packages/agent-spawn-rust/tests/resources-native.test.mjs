import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { createFsFromVolume, Volume } from "memfs";
import * as own from "../dist/index.js";
import * as original from "../../agent-spawn/dist/skill-bridge.js";
import { getAgentConfig, resolveSkillDir } from "../../agent-skill-config/dist/index.js";
import { resetOutputFormatCache as resetOwnOutputFormatCache } from "../dist/design/index.js";
import { resetOutputFormatCache } from "../../toolcraft-design/dist/index.js";
import { setGitDirRunnerForTest as setOwnGitRunner } from "../dist/skills/index.js";
import { setGitDirRunnerForTest as setHookGitRunner } from "../dist/hooks/skill/testing.js";
import { setGitDirRunnerForTest as setSdkGitRunner } from "../../agent-skill-config/dist/index.js";

const volume = Volume.fromJSON({}),
  memory = createFsFromVolume(volume);
for (const name of [
  "existsSync",
  "readFileSync",
  "writeFileSync",
  "mkdirSync",
  "lstatSync",
  "statSync",
  "readdirSync",
  "realpathSync",
  "symlinkSync",
  "readlinkSync",
  "unlinkSync",
  "rmdirSync",
  "rmSync",
  "copyFileSync",
  "renameSync"
]) {
  if (typeof memory[name] === "function") mock.method(fs, name, memory[name].bind(memory));
}
mock.method(crypto, "randomUUID", () => "resource-test-run");
mock.method(os, "homedir", () => "/home/resource-test");
syncBuiltinESMExports();
const cwd = "/workspace/resource-test",
  home = "/home/resource-test";
for (const setter of [setOwnGitRunner, setHookGitRunner, setSdkGitRunner])
  setter(() => cwd + "/.git");
function run(api, references, hooks) {
  volume.reset();
  const source = resolveSkillDir(getAgentConfig("claude-code"), "local", cwd, home);
  volume.fromJSON({
    [source + "/review/SKILL.md"]: "# Review\nCheck the repository.\n",
    [cwd + "/.git/info/exclude"]: "user entry\n",
    [cwd + "/.claude/settings.json"]: JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "${CLAUDE_PROJECT_DIR}/run" }] }] }
    })
  });
  const before = volume.toJSON();
  const manifest = api.bridgeResourcesForRun("codex", cwd, references, hooks);
  const during = volume.toJSON();
  api.cleanupResourcesForRun(manifest);
  const after = volume.toJSON();
  api.cleanupResourcesForRun(manifest);
  assert.deepEqual(volume.toJSON(), after);
  return { manifest, before, during, after };
}
test("owned resource bridge skips empty requests and retains finite cleanup", () => {
  assert.equal(own.bridgeResourcesForRun("codex", cwd, undefined, undefined), undefined);
  assert.equal(own.bridgeResourcesForRun("codex", cwd, [], undefined), undefined);
  own.cleanupResourcesForRun(undefined);
  assert.deepEqual(run(own, ["claude/review"]), run(original, ["claude/review"]));
});
test("owned resource bridge combines hook transformation and skill ownership", () => {
  const hooks = { from: "claude", strategy: "transform", scope: "project" };
  const actual = run(own, ["claude/review"], hooks);
  assert.equal(actual.manifest.skills.entries.length, 1);
  assert.equal(actual.manifest.hooks.strategy, "transform");
  assert.deepEqual(actual, run(original, ["claude/review"], hooks));
  assert.deepEqual(actual.after, actual.before);
});
test("owned resource bridge rolls back skills after a hook host failure and can retry", () => {
  for (const api of [own, original]) {
    run(api, ["claude/review"]);
    const before = volume.toJSON(),
      reason = new Error("hook policy denied");
    const reader = mock.method(fs, "lstatSync", (target) => {
      if (String(target) === cwd + "/.claude/settings.json") throw reason;
      return memory.lstatSync(target);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () =>
          api.bridgeResourcesForRun("codex", cwd, ["claude/review"], {
            from: "claude",
            strategy: "transform",
            scope: "project"
          }),
        (error) => error === reason
      );
    } finally {
      reader.mock.restore();
      syncBuiltinESMExports();
    }
    assert.deepEqual(volume.toJSON(), before);
    assert.ok(
      run(api, ["claude/review"], { from: "claude", strategy: "transform", scope: "project" })
        .manifest.hooks
    );
  }
});
test("owned resource bridge preserves collision warnings and cleanup", () => {
  const prior = process.env.OUTPUT_FORMAT;
  process.env.OUTPUT_FORMAT = "json";
  resetOutputFormatCache();
  resetOwnOutputFormatCache();
  let output = "";
  const writer = mock.method(process.stdout, "write", (text) => {
    output += text;
    return true;
  });
  try {
    const first = run(own, ["claude/review", "claude/review"]),
      ownOutput = output;
    output = "";
    const second = run(original, ["claude/review", "claude/review"]);
    assert.deepEqual(first, second);
    assert.equal(ownOutput, output);
    assert.ok(output.includes('"level":"warn"'));
  } finally {
    writer.mock.restore();
    if (prior === undefined) delete process.env.OUTPUT_FORMAT;
    else process.env.OUTPUT_FORMAT = prior;
    resetOutputFormatCache();
    resetOwnOutputFormatCache();
  }
});

test("owned resource bridge rejects missing skills without touching the target", () => {
  const results = [];
  for (const api of [own, original]) {
    let failure;
    try {
      run(api, ["claude/missing"]);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(volume.existsSync(cwd + "/.codex/skills/review"), false);
    results.push({ name: failure.name, message: failure.message, files: volume.toJSON() });
  }
  assert.deepEqual(results[0], results[1]);
});
