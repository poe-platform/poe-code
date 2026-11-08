import assert from "node:assert/strict";
import test from "node:test";
import { createXxdCommand, xxdCommands } from "./index.js";

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts";

async function run(args: string[], input = new Uint8Array(), fs = createMemoryFileSystem()) {
  const chunks: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: CommandContext = {
    command: "xxd", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () { yield input; })(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
    signal: new AbortController().signal,
  };
  const result = await createXxdCommand().execute(context);
  return { ...result, bytes: Buffer.concat(chunks), error: Buffer.concat(errors).toString(), fs };
}

test("explicit infinite input limits are accepted in both option forms", () => {
  for (const options of [{ maxInputBytes: Infinity }, { limits: { maxInputBytes: Infinity } }]) {
    assert.doesNotThrow(() => xxdCommands(options));
  }
});

test("autoskip preserves short zero runs and the final row", async () => {
  for (const flag of ["-a", "-autoskip"]) {
    for (const length of [16, 32, 48, 64, 80]) {
      const input = new Uint8Array(length);
      const normal = await run([], input);
      const lines = normal.bytes.toString().trimEnd().split("\n");
      const expected = length < 64 ? normal.bytes.toString() : `${lines[0]}\n*\n${lines.at(-1)}\n`;
      const actual = await run([flag], input);
      assert.equal(actual.exitCode, 0, actual.error);
      assert.equal(actual.bytes.toString(), expected);
      const reversed = await run(["-r"], actual.bytes);
      assert.equal(reversed.exitCode, 0, reversed.error);
      assert.deepEqual(reversed.bytes, Buffer.from(input));
    }
  }
  const input = new Uint8Array(49); input[48] = 120;
  const actual = await run(["-a"], input);
  assert.equal(actual.bytes.toString().split("\n")[1], "*");
  assert.deepEqual((await run(["-r"], actual.bytes)).bytes, Buffer.from(input));
});

test("signed file seeks accept negative and plus-prefixed offsets", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/text.txt", new TextEncoder().encode("0123456789"));
  for (const seek of ["-6", "+4"]) {
    const actual = await run(["-s", seek, "-p", "/text.txt"], undefined, fs);
    assert.equal(actual.exitCode, 0, actual.error);
    assert.equal(actual.bytes.toString(), "343536373839\n");
  }
  assert.equal((await run(["-s", "+-6", "/text.txt"], undefined, fs)).bytes.toString().startsWith("00000004:"), true);
  assert.notEqual((await run(["-s", "-6"], new Uint8Array(10))).exitCode, 0);
});

test("outfile supports dumps and sparse reverse without truncating existing tails", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array([65, 66]));
  const dump = await run(["/input", "/dump"], undefined, fs);
  assert.equal(dump.exitCode, 0, dump.error);
  assert.equal(dump.bytes.length, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/dump")), (await run([], new Uint8Array([65, 66]))).bytes.toString());
  const reverse = await run(["-r", "/dump", "/output"], undefined, fs);
  assert.equal(reverse.exitCode, 0, reverse.error);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([65, 66]));
  await fs.writeFile("/output", new Uint8Array([1, 2, 3, 4, 5]));
  const patch = await run(["-r", "-", "/output"], new TextEncoder().encode("00000002: ff\n"), fs);
  assert.equal(patch.exitCode, 0, patch.error);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([1, 2, 255, 4, 5]));
});

test("reverse zero-fills sparse addresses, including a final unterminated line", async () => {
  const actual = await run(["-r"], new TextEncoder().encode("00000004: 4142\n*\n00000008: 43"));
  assert.equal(actual.exitCode, 0, actual.error);
  assert.deepEqual(actual.bytes, Buffer.from([0, 0, 0, 0, 65, 66, 0, 0, 67]));
});

test("capitalize applies to include variable and length identifiers", async () => {
  for (const flag of ["-C", "-capitalize"]) {
    const actual = await run(["-i", flag, "-n", "text.txt"], new Uint8Array([65]));
    assert.equal(actual.exitCode, 0, actual.error);
    assert.equal(actual.bytes.toString(), "unsigned char TEXT_TXT[] = {\n  0x41\n};\nunsigned int TEXT_TXT_LEN = 1;\n");
  }
});


test("reverse outfile accepts out-of-order addresses and plain seeks", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/output", new Uint8Array([1, 2, 3, 4, 5]));
  const patched = await run(["-r", "-", "/output"], new TextEncoder().encode("00000003: aa\n00000001: bb\n"), fs);
  assert.equal(patched.exitCode, 0, patched.error);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([1, 187, 3, 170, 5]));
  const plain = await run(["-r", "-p", "-s", "2", "-", "/output"], new TextEncoder().encode("cc"), fs);
  assert.equal(plain.exitCode, 0, plain.error);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([1, 187, 204, 170, 5]));
  const empty = await run(["-r", "-", "/output"], undefined, fs);
  assert.equal(empty.exitCode, 0, empty.error);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([1, 187, 204, 170, 5]));
});

test("reverse outfile handles short writes and closes after malformed input", async () => {
  const fs = createMemoryFileSystem();
  const open = fs.open!.bind(fs);
  let closed = 0;
  fs.open = async (path, options) => {
    const descriptor = await open(path, options);
    return { ...descriptor,
      write: (bytes, position, options) => descriptor.write(bytes.subarray(0, 1), position, options),
      async close() { closed++; await descriptor.close(); },
    };
  };
  const result = await run(["-r", "-", "/output"], new TextEncoder().encode("00000002: 4142\ninvalid\n"), fs);
  assert.equal(result.exitCode, 1);
  assert.equal(closed, 1);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([0, 0, 65, 66]));
});
