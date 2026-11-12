import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, RGB24 pixels at depth 8.
const plain = { width: 24, height: 8, hash: "08121d7b99af6a029b4f4494a9681842e613b413f248bd5fd5281880ced8ac93" };
const framed = { width: 80, height: 36, hash: "da81a80c77ce7edb7ec696a58898cdb3b51f832d9a28035ede1671a8d31f4ab4" };
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { inputs: ["xc:red", "xc:blue"], expected: plain },
  { inputs: ["-caption", "Hi", "xc:red", "xc:blue"], expected: plain },
  { inputs: ["-caption", "Hi", "xc:red", "xc:blue", "-polaroid", "0"], expected: {
    width: 80, height: 62, hash: "33cc0f0232dff718ae2105195862d212d3167ab1210f56bc70ba38aa6120e0f2"
  } },
  { inputs: ["-caption", "Hi", "+caption", "xc:red", "xc:blue", "-polaroid", "0"], expected: framed },
  { inputs: ["xc:red", "xc:blue", "-caption", "Hi", "-polaroid", "0"], expected: framed },
  { inputs: ["-caption", "Hi", "xc:red", "+caption", "xc:blue", "-polaroid", "0"], expected: {
    width: 80, height: 62, hash: "efd608007b503767de5a196d33b9952ffe195b0b957818e2a26470538fbd1993"
  } },
  { inputs: ["xc:red", "-caption", "Hi", "xc:blue", "-polaroid", "0"], expected: {
    width: 80, height: 62, hash: "a82d7b31780d120494cd43875a79d3033f28240157d0ed776a33aa0b9a12c17c"
  } },
  { inputs: ["-caption", "Hi", "xc:red", "xc:blue", "+caption", "-polaroid", "0"], expected: {
    width: 80, height: 62, hash: "33cc0f0232dff718ae2105195862d212d3167ab1210f56bc70ba38aa6120e0f2"
  } },
  { inputs: ["-caption", "Hi", "xc:red", "-caption", "H", "xc:blue", "-polaroid", "0"], expected: {
    width: 80, height: 62, hash: "0ea025377a47912deda19936f8f88dca2cda38d7e276320fe5ed055a96c8e638"
  } }
])(`preserves montage input caption timing via ${mode}: $inputs`, async ({ inputs, expected }) => {
  const args = ["-size", "12x8", ...inputs, "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(stdout);
  } else {
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const header = Buffer.from(`P6\n${expected.width} ${expected.height}\n255\n`);
  expect(Buffer.from(output.subarray(0, header.length))).toEqual(header);
  const pixels = output.subarray(header.length);
  expect(pixels.byteLength).toBe(expected.width * expected.height * 3);
  expect(createHash("sha256").update(pixels).digest("hex")).toBe(expected.hash);
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each(["-caption", "-polaroid"])(`rejects a missing %s argument via ${mode} without writing output`, async option => {
  const args = ["-size", "12x8", "xc:red", option];
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stderr: `montage: missing argument for ${option}\n` });
  expect(result.stdoutBytes?.byteLength ?? 0).toBe(0);
  expect(files.size).toBe(0);
});
