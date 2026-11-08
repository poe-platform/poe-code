import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createWhichCommand, createWhichCommands, whichCommands, type WhichLimits } from "./index.js";
import { settings } from "./options.js";

const unlimited: WhichLimits = {
  maxArguments: Infinity,
  maxArgumentBytes: Infinity,
  maxPathEnvBytes: Infinity,
  maxPathComponents: Infinity,
  maxPathBytes: Infinity,
  maxProbes: Infinity,
  maxOutputBytes: Infinity,
};

test("which defaults to unlimited quotas and accepts explicit Infinity in every factory", () => {
  assert.deepEqual(settings({}), unlimited);
  for (const key of Object.keys(unlimited)) {
    for (const create of [createWhichCommand, createWhichCommands, whichCommands]) {
      assert.doesNotThrow(() => create({ limits: { [key]: Infinity } }));
    }
    assert.deepEqual(settings({ limits: { [key]: 1 } }), { ...unlimited, [key]: 1 });
    for (const value of [0, -1, 1.5, NaN, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createWhichCommand({ limits: { [key]: value } }), RangeError);
    }
  }
});

test("which admits operands beyond former defaults while enforcing an explicit quota", async () => {
  const values = createCommandArguments([
    `-${"s".repeat(65_536)}`, ...Array<string>(4095).fill("-s"), "demo",
  ]);
  const path = `/bin${":".repeat(4096)}${"d".repeat(65_536)}`;
  for (const [limits, limited] of [
    [undefined, false], [unlimited, false], [{ maxOutputBytes: 1 }, false], [{ maxArguments: 4096 }, true],
  ] as const) {
    let stdout = "";
    let stderr = "";
    let probes = 0;
    const result = await createWhichCommand(limits === undefined ? {} : { limits }).execute({
      command: "which", args: values.args, argumentValues: values,
      cwd: `/${"d".repeat(16_384)}`, env: { PATH: path },
      fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
      commandDiscovery: {
        defaultPath: path,
        isExecutable(lookup) { probes++; return lookup === "/bin/demo"; },
      },
    });
    assert.equal(result.exitCode, limited ? 1 : 0, stderr);
    assert.equal(stdout, "");
    assert.equal(stderr, limited ? "which: maxArguments limit exceeded\n" : "");
    assert.equal(probes, limited ? 0 : 1);
  }
});
