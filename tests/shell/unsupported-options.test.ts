import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

test("native-backed errexit forms stop before subsequent commands and file effects", async () => {
  const reference = bashResult("set -e; false; printf bad >after");
  assert.equal(reference.exitCode, 1);
  assert.deepEqual(reference.files, {});
  for (const source of [
    "set -e; false; say bad >after",
    "set -o errexit; false; say bad >after",
  ]) {
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("unsupported combined shell options fail closed before subsequent commands", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec("set -eu || say unsafe >after");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unsupported shell option/u);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("supported set forms still execute normally", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('set -- a b; args "$@"')).stdout, '["a","b"]');
  assert.equal((await shell.exec("set -o pipefail; false | true")).exitCode, 1);
  assert.equal((await shell.exec("set +o pipefail; false | true")).exitCode, 0);
});
