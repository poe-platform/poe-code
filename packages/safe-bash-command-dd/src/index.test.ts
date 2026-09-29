import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { builtInDirectContextExecutors, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createDdCommand, createDdCommands, ddCommands, type DdLimits } from "./index.js";

test("canonical dd factories retain default executor admission without admitting configured limits", () => {
  for (const options of [{}, { replace: true }, { maxTransferBytes: undefined }]) {
    assert.equal(builtInDirectContextExecutors.has(createDdCommands(options)[0]!.execute), true);
  }
  for (const options of [{ maxTransferBytes: 1 }, { limits: { maxTransferBytes: 1 } }]) {
    assert.equal(builtInDirectContextExecutors.has(createDdCommands(options)[0]!.execute), false);
  }
});

test("dd copies and converts uppercase", async () => {
  assert.equal(createDdCommands().length, 1);
  assert.equal(ddCommands().name, "dd-commands");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.txt", new TextEncoder().encode("hello world"));
  const cmd = createDdCommand();
  const res = await cmd.execute({
    command: "dd",
    args: createCommandArguments(["if=/in.txt", "of=/out.txt", "conv=ucase", "status=none"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: createBytePipe().writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  assert.equal(res.exitCode, 0);
  const out = new TextDecoder().decode(await fs.readFile("/out.txt"));
  assert.equal(out, "HELLO WORLD");
});

const limitNames = ["maxBlockBytes", "maxBufferBytes", "maxTransferBytes", "maxReadOperations", "maxArgumentBytes"] as const;
for (const name of limitNames) {
  test(`dd accepts Infinity for ${name}`, () => {
    assert.doesNotThrow(() => createDdCommand({ [name]: Infinity }));
    assert.doesNotThrow(() => ddCommands({ limits: { [name]: Infinity } }));
  });
}

test("dd enforces nested limits ahead of legacy limits", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("hello"));
  const cmd = createDdCommand({ maxTransferBytes: Infinity, limits: { maxTransferBytes: 2 } });
  const result = await cmd.execute({
    command: "dd", args: createCommandArguments(["if=/input", "status=none"]).args,
    cwd: "/", env: {}, fs, stdin: (async function* () {})(),
    stdout: createBytePipe().writable, stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  assert.notEqual(result.exitCode, 0);
});

for (const name of limitNames) {
  test(`dd validates nested ${name}`, () => {
    const limits: Partial<DdLimits> = { [name]: -1 };
    assert.throws(() => createDdCommand({ limits }), RangeError);
    assert.throws(() => createDdCommand({ limits: { [name]: NaN } }), RangeError);
    assert.throws(() => createDdCommand({ limits: { [name]: 1.5 } }), RangeError);
  });
}
