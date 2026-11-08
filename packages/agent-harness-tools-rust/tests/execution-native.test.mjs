import test from "node:test";
import assert from "node:assert/strict";
import { native } from "../dist/native.js";
import {
  applyRuntimeOverrides,
  resolvePoeCommandExecution,
  registerExecutionEnvFactory,
  UnsupportedRuntimeCapabilityError
} from "../dist/index.js";
import { parseRuntime } from "../dist/config/core.js";

test("runtime capability reads are lazy and preserve callback exceptions", () => {
  for (const [values, expected, calls] of [
    [{ detach: false, wantsTransfer: false }, null, ["detach", "wantsTransfer"]],
    [{ detach: true, supportsDetach: false }, "detach", ["detach", "supportsDetach"]],
    [
      { detach: false, wantsTransfer: true, supportsTransfer: false },
      "transfer",
      ["detach", "wantsTransfer", "supportsTransfer"]
    ],
    [
      { detach: true, supportsDetach: true, wantsTransfer: true, supportsTransfer: true },
      null,
      ["detach", "supportsDetach", "wantsTransfer", "supportsTransfer"]
    ]
  ]) {
    const observed = [];
    assert.equal(
      native.harnessRuntimeAdmission((fact) => {
        observed.push(fact);
        return values[fact];
      }),
      expected
    );
    assert.deepEqual(observed, calls);
  }
  const failure = new Error("foreign getter");
  assert.throws(
    () =>
      native.harnessRuntimeAdmission(() => {
        throw failure;
      }),
    (error) => error === failure
  );
});

test("runtime overrides retain input identity and factory capability errors", () => {
  const runtime = parseRuntime({ type: "host" }),
    runner = { detach: false, sync: "auto" },
    base = { runtime, runner };
  const unchanged = applyRuntimeOverrides(base, undefined, "/nonexistent-rust-execution-project");
  assert.equal(unchanged.runtime, runtime);
  assert.equal(unchanged.runner, runner);
  const state = { jobs: {}, templates: {} },
    factory = { type: "host", supportsDetach: false, supportsWorkspaceTransfer: false };
  registerExecutionEnvFactory(factory);
  const input = {
    cwd: "/nonexistent-rust-execution-project",
    env: { FAKE: "1" },
    argv: ["test"],
    tool: "test",
    context: { homeDir: "/nonexistent-rust-execution-home", state }
  };
  const result = resolvePoeCommandExecution(input);
  assert.equal(result.factory, factory);
  assert.equal(result.state, state);
  assert.equal(result.openSpec.env, input.env);
  assert.equal(result.openSpec.jobLabel.argv, input.argv);
  for (const runtime of [{ detach: true }, { runnerSync: "upload" }])
    assert.throws(
      () => resolvePoeCommandExecution({ ...input, runtime }),
      (error) => error instanceof UnsupportedRuntimeCapabilityError
    );
  assert.equal(base.runner.detach, false);
});
