import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createFsFromVolume, Volume } from "memfs";

const own = await import("../dist/index.js");
await import("../../agent-spawn/dist/index.js");
const original = await import("../../agent-spawn/dist/runtime.js");
const volume = Volume.fromJSON({}),
  memory = createFsFromVolume(volume);
mock.method(fs, "existsSync", memory.existsSync.bind(memory));
mock.method(fs, "readFileSync", memory.readFileSync.bind(memory));
syncBuiltinESMExports();
const homeDir = "/home/runtime-test",
  cwd = "/workspace/runtime-test";
function input(extra = {}) {
  return {
    cwd,
    env: { MARKER: "retained" },
    argv: ["codex", "private prompt"],
    displayArgv: ["codex", "<prompt>"],
    tool: "spawn",
    context: { homeDir },
    ...extra
  };
}
function comparable(resolved) {
  const spec = Object.fromEntries(Object.entries(resolved.openSpec).filter(([key]) => key !== "state"));
  return {
    factory: {
      type: resolved.factory.type,
      supportsDetach: resolved.factory.supportsDetach,
      supportsWorkspaceTransfer: resolved.factory.supportsWorkspaceTransfer
    },
    detach: resolved.detach,
    spec
  };
}
test("owned runtime resolution retains defaults, host effects and caller identities", async () => {
  const supplied = input({ openSpec: { execution: { captureStdout: false } } });
  const result = own.resolveSpawnExecution(supplied);
  assert.deepEqual(comparable(result), comparable(original.resolveSpawnExecution(supplied)));
  assert.equal(result.openSpec.env, supplied.env);
  assert.equal(result.openSpec.jobLabel.argv, supplied.argv);
  assert.equal(result.openSpec.jobLabel.displayArgv, supplied.displayArgv);
  assert.equal(result.openSpec.execution, supplied.openSpec.execution);
  const opened = await result.factory.open(result.openSpec);
  assert.equal(opened.id, "host");
  assert.equal(opened.job, null);
  assert.deepEqual(await opened.uploadWorkspace(), { files: 0, bytes: 0, skipped: [] });
  assert.deepEqual(await opened.downloadWorkspace({ conflictPolicy: "refuse" }), {
    files: 0,
    bytes: 0,
    conflicts: []
  });
  await assert.rejects(opened.detach(), {
    message: "host runtime does not support detach because host has no addressable env"
  });
  await assert.rejects(result.factory.attach("host"), {
    message: "host runtime does not support reattach"
  });
  await opened.close();
});
test("owned runtime reads merged policies, selects docker and preserves open spec overrides", () => {
  volume.fromJSON({
    [homeDir + "/.poe-code/config.json"]: JSON.stringify({
      runtime: { type: "docker", image: "base:image", runner: { detach: true } }
    }),
    [cwd + "/.poe-code/config.json"]: JSON.stringify({
      runtime: { image: "project:image", runner: { workspace: { exclude: ["private"] } } }
    })
  });
  try {
    for (const runtime of [
      undefined,
      { runtimeImage: "override:image" },
      { mountPoeCode: true },
      { runnerSync: "upload" }
    ]) {
      const supplied = input({ runtime });
      assert.deepEqual(
        comparable(own.resolveSpawnExecution(supplied)),
        comparable(original.resolveSpawnExecution(supplied))
      );
    }
  } finally {
    volume.reset();
  }
});
test("owned runtime capability and malformed configuration diagnostics match the SDK", () => {
  for (const runtime of [{ detach: true }, { runnerSync: "upload" }]) {
    let expected;
    try {
      original.resolveSpawnExecution(input({ runtime }));
    } catch (error) {
      expected = error;
    }
    assert.ok(expected);
    assert.throws(
      () => own.resolveSpawnExecution(input({ runtime })),
      (error) => error.name === expected.name && error.message === expected.message
    );
  }
  volume.fromJSON({ [homeDir + "/.poe-code/config.json"]: "{" });
  try {
    assert.throws(() => own.resolveSpawnExecution(input()), SyntaxError);
  } finally {
    volume.reset();
  }
});
