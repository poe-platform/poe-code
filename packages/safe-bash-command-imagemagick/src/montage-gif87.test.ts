import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Walk blocks through each trailer; image data can itself contain GIF signatures.
function gifStreams(bytes: Uint8Array): { bytes: Uint8Array; frames: number }[] {
  const streams: { bytes: Uint8Array; frames: number }[] = [];
  let at = 0;
  while (at < bytes.length) {
    const start = at;
    expect(["GIF87a", "GIF89a"]).toContain(new TextDecoder().decode(bytes.subarray(at, at + 6)));
    const flags = bytes[at + 10]!;
    at += 13 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0);
    let frames = 0;
    while (bytes[at] !== 0x3b) {
      expect(at).toBeLessThan(bytes.length);
      const block = bytes[at++];
      if (block === 0x2c) {
        frames++;
        const imageFlags = bytes[at + 8]!;
        at += 9 + (imageFlags & 128 ? 3 * (1 << ((imageFlags & 7) + 1)) : 0);
        at++; // LZW minimum code size
      } else {
        expect(block).toBe(0x21);
        at++; // Extension label
      }
      while (bytes[at] !== 0) {
        expect(at).toBeLessThan(bytes.length);
        at += bytes[at]! + 1;
      }
      at++;
    }
    streams.push({ bytes: bytes.subarray(start, ++at), frames });
  }
  return streams;
}

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { tile: "1x1", coder: "gif87", signature: "GIF87a", frames: [1, 1], width: 1 },
  { tile: "2x1", coder: "gif87", signature: "GIF87a", frames: [1], width: 2 },
  { tile: "1x1", coder: "gif", signature: "GIF89a", frames: [2], width: 1 },
])(`writes $coder montage streams with tile $tile via ${mode}`, async ({ tile, coder, signature, frames, width }) => {
  const args = ["xc:red", "xc:blue", "-tile", tile, "-geometry", "+0+0", `${coder}:-`];
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
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const streams = gifStreams(output);
  expect(streams.map(stream => stream.frames)).toEqual(frames);
  const pixels: number[] = [];
  for (const stream of streams) {
    expect(new TextDecoder().decode(stream.bytes.subarray(0, 6))).toBe(signature);
    const image = decodeImage(stream.bytes, { animated: true });
    expect(image.width).toBe(width);
    expect(image.height).toBe(stream.frames);
    pixels.push(...image.data);
  }
  expect(pixels).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
});
