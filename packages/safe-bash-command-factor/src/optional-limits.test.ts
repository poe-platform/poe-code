import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./internal.js";
import { createFactorCommand } from "./index.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";

test("factor limits accept omitted, undefined and Infinity while validating finite opt-ins", () => {
  const defaults = settings({});
  for (const [key, value] of Object.entries(defaults)) {
    assert.equal(value, Infinity, key);
    for (const disabled of [undefined, Infinity]) {
      assert.deepEqual(settings({ limits: { [key]: disabled } }), defaults);
    }
    assert.deepEqual(settings({ limits: { [key]: 8 } }), { ...defaults, [key]: 8 });
    for (const invalid of [0, -1, NaN, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => settings({ limits: { [key]: invalid } }), RangeError);
    }
  }
});

test("factor admits arbitrary-precision inputs and retains explicit BigInt ceilings", async () => {
  for (const maxValue of [undefined, Infinity, 4294967295n]) {
    const values = createCommandArguments(["4294967297", "18446744073709551616"]);
    let stdout = "", stderr = "";
    const result = await createFactorCommand({ limits: { maxValue } }).execute({
      command: "factor", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    if (maxValue === 4294967295n) {
      assert.equal(result.exitCode, 1);
      assert.match(stderr, /exceeds supported maximum/);
      assert.equal(stdout, "");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stdout, `4294967297: 641 6700417\n18446744073709551616: ${Array(64).fill("2").join(" ")}\n`);
    }
  }
});
