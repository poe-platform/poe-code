import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createQrencodeCommand } from "./index.js";

async function run(
  args: string[],
  input: string | Uint8Array = "",
  extra: Partial<CommandContext> = {},
  limits = {}
) {
  const output: Uint8Array[] = [],
    errors: Uint8Array[] = [];
  const fs = extra.fs ?? createMemoryFileSystem();
  const result = await createQrencodeCommand({ limits }).execute({
    command: "qrencode",
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs,
    stdin: toByteSource(input),
    stdout: {
      async write(b) {
        output.push(b.slice());
      }
    },
    stderr: {
      async write(b) {
        errors.push(b.slice());
      }
    },
    signal: new AbortController().signal,
    ...extra
  });
  return { ...result, fs, stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString() };
}

const nativeAvailable = spawnSync("qrencode", ["--version"]).status === 0;

test("all terminal renderers agree with native qrencode", { skip: !nativeAvailable }, async () => {
  for (const type of ["ASCII", "ASCIIi", "UTF8", "UTF8i", "ANSI", "ANSI256", "ANSIUTF8"]) {
    const args = ["-t", type, "-m", "2", "--micro", "12345"];
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      result.stdout.toString(),
      execFileSync("qrencode", args, { encoding: "utf8" }),
      type
    );
  }
});

test("VFS input, output, PNG colors and density", async () => {
  const { decodeImage } = await import("@poe-code/image-ast/portable");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("HELLO"));
  const result = await run(
    [
      "-r",
      "input",
      "-o",
      "qr.png",
      "-s",
      "2",
      "-m",
      "1",
      "-d",
      "144",
      "--foreground=FF000080",
      "--background=00FF00FF"
    ],
    "",
    { fs }
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const png = decodeImage(await fs.readFile("/qr.png"));
  assert.equal(png.width, 46);
  assert.equal(png.density, 144);
  assert.deepEqual([...png.data.slice(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual([...png.data.slice((2 * 46 + 2) * 4, (2 * 46 + 2) * 4 + 4)], [255, 0, 0, 128]);
});

test("rejects invalid options and admits memory before large output", async () => {
  for (const args of [
    ["-s", "0"],
    ["-v", "41"],
    ["-l", "X"],
    ["--foreground=zzzzzz"],
    ["--micro", "-l", "H"],
    ["-S"],
    ["-t", "bad"]
  ]) {
    assert.notEqual((await run([...args, "hello"])).exitCode, 0, args.join(" "));
  }
  assert.notEqual((await run(["-o", "/huge.png", "-s", "1000000", "hello"])).exitCode, 0);
  assert.notEqual((await run(["-t", "SVG", "hello"], "", {}, { maxMemoryBytes: 64 })).exitCode, 0);
});

test("pre-abort preserves reason and avoids input/output", async () => {
  const controller = new AbortController(),
    reason = { cancelled: true };
  controller.abort(reason);
  await assert.rejects(
    run(["-t", "ASCII", "hello"], "", { signal: controller.signal }),
    (e) => e === reason
  );
});

test("structured append creates numbered VFS symbols", async () => {
  const result = await run(["-S", "-v", "1", "-8", "-o", "/qr.svg", "-t", "SVG"], "x".repeat(40));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok((await result.fs.readFile("/qr-01.svg")).length);
  assert.ok((await result.fs.readFile("/qr-03.svg")).length);
});

test("small structured symbols fit a bounded encoding workspace", async () => {
  const result = await run(
    ["-S", "-v", "1", "-8", "-o", "/qr.png"],
    "x".repeat(40),
    {},
    { maxMemoryBytes: 2359296 }
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok((await result.fs.readFile("/qr-03.png")).length);
});

test(
  "raw bytes, Kanji, case folding, minimum and strict versions",
  { skip: !nativeAvailable },
  async () => {
    for (const [args, input] of [
      [["-8"], Uint8Array.from([0, 255, 128, 65])],
      [["-k"], Uint8Array.from([0x93, 0xfa, 0x96, 0x7b])],
      [["-k", "-i"], Uint8Array.from([0x81, 0x61])],
      [["-i"], new TextEncoder().encode("hello world")],
      [["-v", "3"], new TextEncoder().encode("1234")]
    ] as const) {
      const flags = ["-t", "ASCII", "-m", "0", ...args];
      const result = await run(flags, input);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(
        result.stdout.toString(),
        execFileSync("qrencode", flags, { input, encoding: "utf8" })
      );
    }
    assert.equal((await run(["-8", "-v", "1", "-t", "ASCII"], "x".repeat(30))).exitCode, 0);
    assert.equal(
      (await run(["-8", "-v", "1", "--strict-version", "-t", "ASCII"], "x".repeat(30))).exitCode,
      1
    );
  }
);

test("stdin chunks retain byte ownership and enforce input/output budgets", async () => {
  const chunk = new Uint8Array(1);
  const result = await run(["-8", "-t", "ASCII"], "", {
    stdin: {
      async *[Symbol.asyncIterator]() {
        for (const byte of [65, 66, 67]) {
          chunk[0] = byte;
          yield chunk;
        }
      }
    }
  });
  assert.deepEqual(result.stdout, (await run(["-8", "-t", "ASCII", "ABC"])).stdout);
  assert.equal((await run(["-t", "ASCII"], "abc", {}, { maxInputBytes: 2 })).exitCode, 1);
  assert.equal((await run(["-t", "ASCII", "abc"], "", {}, { maxOutputBytes: 5 })).exitCode, 1);
});

test("cancellation during encoding preserves the reason", async () => {
  const controller = new AbortController(),
    reason = { stop: true };
  const execution = run(["-t", "ASCII"], "1".repeat(7000), { signal: controller.signal });
  setImmediate(() => controller.abort(reason));
  await assert.rejects(execution, (e) => e === reason);
});
