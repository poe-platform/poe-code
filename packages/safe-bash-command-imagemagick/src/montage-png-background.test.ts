import { crc32 } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { background: undefined, rgb: [255, 255, 255] },
  { background: "lime", rgb: [0, 255, 0] },
  { background: "#123456", rgb: [18, 52, 86] },
])(`writes truecolor PNG montage metadata via ${mode}: $background`, async ({ background, rgb }) => {
  const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0",
    ...(background ? ["-background", background] : []), "png24:-"];
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
  const image = decodeImage(output);
  expect([image.width, image.height]).toEqual([2, 1]);
  expect(Buffer.from(image.data).toString("hex")).toBe("ff0000ff0000ffff");
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const chunks = new Map<string, Uint8Array[]>();
  for (let offset = 8; offset < output.length; offset += view.getUint32(offset) + 12) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...output.subarray(offset + 4, offset + 8));
    expect(view.getUint32(offset + 8 + length)).toBe(crc32(output.subarray(offset + 4, offset + 8 + length)));
    chunks.set(type, [...chunks.get(type) ?? [], output.slice(offset + 8, offset + 8 + length)]);
  }
  expect([...chunks.get("IHDR")![0]!.subarray(8, 10)]).toEqual([8, 2]);
  expect(chunks.get("bKGD")?.map(bytes => [...bytes])).toEqual([rgb.flatMap(value => [0, value])]);
  // ImageMagick 7.1.2-35 emits the default sRGB chromaticities for each sheet.
  expect(chunks.get("cHRM")?.map(bytes => {
    const coordinates = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: bytes.length / 4 }, (_, index) => coordinates.getUint32(index * 4));
  })).toEqual([[31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000]]);
  const names = [...chunks.keys()];
  expect(names.indexOf("bKGD")).toBeLessThan(names.indexOf("IDAT"));
  expect(names.indexOf("cHRM")).toBeLessThan(names.indexOf("IDAT"));
});
