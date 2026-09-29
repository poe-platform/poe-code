import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { Volume } from "memfs";
import { runNativeTests } from "./run-native-tests.mjs";

function fixture(t, result) {
  const volume = Volume.fromJSON({
    "/package/tests/b.test.mjs": "",
    "/package/tests/a.test.mjs": "",
    "/package/tests/engine.rs": ""
  });
  t.mock.method(fs, "readdirSync", volume.readdirSync.bind(volume));
  const spawn = t.mock.method(childProcess, "spawnSync", () => result);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return spawn;
}

test("native tests bound test execution and process cleanup while retaining file diagnostics", t => {
  const spawn = fixture(t, { status: 0 });
  runNativeTests("/package");
  assert.equal(spawn.mock.callCount(), 1);
  const [command, args, options] = spawn.mock.calls[0].arguments;
  assert.equal(command, process.execPath);
  assert.deepEqual(args, ["--test", "--test-timeout=60000", "tests/a.test.mjs", "tests/b.test.mjs"]);
  assert.equal(options.cwd, "/package");
  assert.equal(options.timeout, 120000);
  assert.equal(options.killSignal, "SIGKILL");
  assert.equal(options.stdio, "inherit");
});

test("a native test process that retains handles fails with its package and deadline", t => {
  fixture(t, { error: Object.assign(new Error("spawn timed out"), { code: "ETIMEDOUT" }), status: null, signal: "SIGKILL" });
  assert.throws(() => runNativeTests("/package"), /Native tests in \/package exceeded 120000ms/);
});

test("native assertion failures and signal termination cannot become successful checks", t => {
  const spawn = fixture(t, { status: 1 });
  assert.throws(() => runNativeTests("/package"), /exited with status 1/);
  spawn.mock.mockImplementation(() => ({ status: null, signal: "SIGABRT" }));
  assert.throws(() => runNativeTests("/package"), /SIGABRT/);
});
