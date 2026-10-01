import assert from "node:assert/strict";
import test from "node:test";
import { createXxdCommand, createXxdCommands, xxdCommands } from "./index.js";

test("xxd command definition exports standard contract", () => {
  const def = createXxdCommand();
  assert.equal(def.name, "xxd");
  assert.equal(typeof def.execute, "function");
  assert.equal(createXxdCommands().length, 1);
  assert.equal(xxdCommands().name, "xxd-commands");
});

import { createMemoryFileSystem, createOverlayFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectText, createBytePipe, createCommandArguments } from "safe-bash-contracts";

async function run(args: string[], fs: FileSystem, maxInputBytes = 1024) {
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const result = await createXxdCommand({ limits: { maxInputBytes } }).execute({
    command: "xxd", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), stdout: stdout.writable, stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  return { ...result, stdout: await collectText(stdout.readable, {}), stderr: await collectText(stderr.readable, {}) };
}

test("xxd accepts Infinity through nested and legacy limit options", () => {
  assert.doesNotThrow(() => createXxdCommand({ limits: { maxInputBytes: Infinity } }));
  assert.doesNotThrow(() => xxdCommands({ maxInputBytes: Infinity }));
});

for (const streamingRead of [undefined, false]) {
  test(`xxd reads overlay files with streamingRead=${streamingRead} and enforces limits`, async () => {
    const lower = createMemoryFileSystem();
    await lower.writeFile("/16", new TextEncoder().encode("hello\0"));
    let fs: FileSystem = createOverlayFileSystem({ lower, upper: createMemoryFileSystem() });
    {
      const overlay = fs;
      fs = new Proxy({} as FileSystem, { get(_target, property) {
        if (property === "capabilities" && streamingRead === false) return { streamingRead: false };
        if (property === "readStream") return streamingRead === false ? () => { throw new Error("must use readFile"); } : undefined;
        const value = Reflect.get(overlay, property);
        return typeof value === "function" ? value.bind(overlay) : value;
      } });
    }
    const result = await run(["16"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
    const limited = await run(["16"], fs, 2);
    assert.notEqual(limited.exitCode, 0);
    assert.ok(limited.stderr.includes("input limit"));
  });
}

for (const value of [-1, NaN, -Infinity, 1.5]) {
  test(`xxd rejects invalid limit ${value}`, () => {
    assert.throws(() => createXxdCommand({ limits: { maxInputBytes: value } }), RangeError);
  });
}


async function runParity(args: string[], input = new Uint8Array(), fs = createMemoryFileSystem()) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createXxdCommand().execute({
    command: "xxd", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () { yield input; })(),
    stdout: { write: async bytes => { stdout.push(bytes.slice()); } },
    stderr: { write: async bytes => { stderr.push(bytes.slice()); } },
    signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
  return Buffer.concat(stdout).toString();
}

test("xxd writes output operands and reverses them", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new TextEncoder().encode("hello world"));
  assert.equal(await runParity(["in", "out.hex"], undefined, fs), "");
  assert.equal(await runParity(["-r", "out.hex", "rt.bin"], undefined, fs), "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/rt.bin")), "hello world");
});

test("xxd seeks relative to EOF", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new TextEncoder().encode("0123456789"));
  for (const seek of ["-5", "+-5"]) {
    assert.equal(await runParity(["-p", "-s", seek, "in"], undefined, fs), "3536373839\n");
  }
});

test("xxd reverses sparse addresses with seek", async () => {
  const input = new TextEncoder().encode("00000004: 4142\n00000008: 43\n");
  assert.equal(await runParity(["-r", "-s", "2"], input), "\0\0\0\0\0\0AB\0\0C");
});

test("xxd autoskips runs of zero rows and capitalizes include identifiers", async () => {
  assert.equal((await runParity(["-a"], new Uint8Array(64))).split("\n")[1], "*");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.bin", new Uint8Array([65]));
  assert.match(await runParity(["-i", "-capitalize", "in.bin"], undefined, fs), /IN_BIN\[\].*IN_BIN_LEN/s);
});

import { execFileSync } from "node:child_process";

test("xxd autoskip matches native at end-of-input and before nonzero data", async () => {
  for (const size of [16, 32, 48, 64, 80]) {
    for (const suffix of [[], [65]]) {
      const input = Uint8Array.from([...new Uint8Array(size), ...suffix]);
      assert.equal(await runParity(["-autoskip"], input), execFileSync("/usr/bin/xxd", ["-a"], { input }).toString());
    }
  }
});

test("xxd reverse accepts nonzero starts and negative seek offsets", async () => {
  const input = new TextEncoder().encode("00000004: 4142\n");
  assert.equal(await runParity(["-r"], input), "\0\0\0\0AB");
  assert.equal(await runParity(["-r", "-s", "-4"], input), "AB");
});

test("xxd reverses autoskip dumps", async () => {
  const bytes = new Uint8Array(64);
  const dump = await runParity(["-a"], bytes);
  assert.equal(await runParity(["-r"], new TextEncoder().encode(dump)), Buffer.from(bytes).toString());
});

test("xxd reverse plain honors the seek offset", async () => {
  const input = new TextEncoder().encode("4142");
  assert.equal(await runParity(["-r", "-p", "-s", "2"], input), "\0\0AB");
});

test("xxd opens include input before emitting its declaration", async () => {
 const result = await run(["-i", "/missing"], createMemoryFileSystem());
 assert.equal(result.exitCode, 2);
 assert.equal(result.stdout, "");
});
test("xxd seeks beyond EOF successfully and resets zero columns", async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/a", new TextEncoder().encode("abc"));
 assert.equal(await runParity(["-s", "10", "/a"], undefined, fs), "");
 assert.equal(await runParity(["-i", "-s", "10", "/a"], undefined, fs), "unsigned char _a[] = {\n};\nunsigned int _a_len = 0;\n");
 assert.equal(await runParity(["-c", "0", "/a"], undefined, fs), await runParity(["/a"], undefined, fs));
 const before = await run(["-s", "-4", "/a"], fs);
 assert.equal(before.exitCode, 4);
 assert.equal(before.stdout, "");
 assert.equal(before.stderr, "xxd: Sorry, cannot seek.\n");
});

test("xxd zero columns selects the display mode default", async () => {
  const input = new Uint8Array([65, 66, 67]);
  for (const mode of [["-i"], ["-b"]]) {
    assert.equal(await runParity([...mode, "-c", "0"], input), await runParity(mode, input));
  }
});
