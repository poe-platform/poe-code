import assert from "node:assert/strict";
import test from "node:test";
import { createBcCommand, settings } from "./index.js";

test("bc command definition exports standard contract", () => {
  const def = createBcCommand();
  assert.equal(def.name, "bc");
  assert.equal(typeof def.execute, "function");
});

test("bc resource quotas are optional with equivalent flat and nested options", () => {
  const defaults = settings();
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(defaults[key], Infinity, key);
    for (const value of [Infinity, 16]) {
      assert.equal(settings({ [key]: value })[key], value);
      assert.equal(settings({ limits: { [key]: value } })[key], value);
    }
    for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ [key]: value }), RangeError);
  }
});


test("bc evaluates exponents above the former implicit ceiling", async () => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { createBytePipe, createCommandArguments } = await import("safe-bash-contracts");
  const stdin = createBytePipe(), stdout = createBytePipe(), stderr = createBytePipe();
  await stdin.writable.write(new TextEncoder().encode("2^20000\nscale=5; 2^-10001\n"));
  await stdin.close();
  const result = await createBcCommand().execute({
    command: "bc", args: createCommandArguments([]).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: stdin.readable,
    stdout: stdout.writable, stderr: stderr.writable, signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stdout.readable) chunks.push(chunk);
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString("utf8"), `${2n ** 20000n}\n0\n`);
});

async function evaluate(program: string, options: Parameters<typeof createBcCommand>[0] = {}) {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { createBytePipe, createCommandArguments } = await import("safe-bash-contracts");
  const stdin = createBytePipe(), stdout = createBytePipe(), stderr = createBytePipe();
  await stdin.writable.write(new TextEncoder().encode(program));
  await stdin.close();
  const result = await createBcCommand(options).execute({
    command: "bc", args: createCommandArguments([]).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: stdin.readable,
    stdout: stdout.writable, stderr: stderr.writable, signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const read = async (source: AsyncIterable<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  };
  return { exitCode: result.exitCode, stdout: await read(stdout.readable), stderr: await read(stderr.readable) };
}

for (const [program, expected] of [
  ["x=0; x++ + sqrt(4); x", "2\n1\n"],
  ["x=0; ++x + a[0]; x", "1\n1\n"],
  ["x=1; (x+=10) + length(123); x", "14\n11\n"],
  ["scale=0; scale++ + sqrt(4); scale", "2.0\n1\n"],
  ["ibase=10; ibase-- + sqrt(4); ibase", "12\n9\n"],
  ["obase=10; obase-- + sqrt(4); obase", "13\n10\n"],
  ["1; last++ + sqrt(4)", "1\n3\n"],
  ["define f() { return (2); }\nx=0; x++ + f(); x", "2\n1\n"],
] as const) {
  test(`bc evaluates side effects once: ${program}`, async () => {
    assert.deepEqual(await evaluate(program), { exitCode: 0, stdout: expected, stderr: "" });
  });
}

for (const [program, expected] of [
  ["1.5^4", "5.0"],
  ["scale=2; 1.09^10", "2.36"],
  ["scale=3; 1.5^-4", ".197"],
  ["scale=3; .2^-4", "625.000"],
  ["scale=0; (-1.5)^3", "-3.3"],
  ["scale=8; 1.50^2", "2.2500"],
  ["scale=2; x=1.09; x^=10; x", "2.36"],
  ["scale=5; 0^0; 2^1.9", "1\n2"],
] as const) {
  test(`bc truncates powers only after exact exponentiation: ${program}`, async () => {
    assert.deepEqual(await evaluate(program), { exitCode: 0, stdout: `${expected}\n`, stderr: "" });
  });
}
