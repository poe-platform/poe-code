import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = [
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6Mjc6MzgrMDA6MDDxzaY+AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjI3OjM4KzAwOjAwgJAeggAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODoyNzozOCswMDowMNeFP10AAAAPSURBVAjXYxBJ+XDCRgMACSsClVyD/nUAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6Mjc6MzgrMDA6MDDxzaY+AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjI3OjM4KzAwOjAwgJAeggAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODoyNzozOCswMDowMNeFP10AAAAPSURBVAjXY/igIZKypQIACcsCvd939nQAAAAASUVORK5CYII="
];

// Native ImageMagick Q16-HDRI, decoded independently as 16-bit RGB.
for (const [operation, expected] of [
  ["Mean", [33410, 17990, 33410, 65535, 38550, 30840, 20560, 65535]],
  ["Max", [61680, 25700, 61680, 65535, 51400, 46260, 30840, 65535]],
  ["Min", [5140, 10280, 5140, 65535, 25700, 15420, 10280, 65535]],
] as const)
for (const mode of ["command", "map", "sync"])
for (const before of [false, true])
for (const after of [false, true])
it(`${mode}: ${operation} preserves pixels with Add 0 before=${before}, after=${after}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  for (const [index, input] of inputs.entries()) {
    const path = `/in${index}.png`, bytes = Buffer.from(input, "base64");
    files.set(path, bytes);
    await fs.writeFile(path, bytes);
  }
  const argv = ["/in0.png", "/in1.png", ...(before ? ["-evaluate", "Add", "0"] : []),
    "-evaluate-sequence", operation, ...(after ? ["-evaluate", "Add", "0"] : []), "-depth", "16", "/out.png"];
  const args = createCommandArguments(argv);
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} },
  }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
  expect(result.exitCode).toBe(0);
  const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
  expect([output.width, output.height]).toEqual([2, 1]);
  expect(Array.from(output.data16 ?? Uint16Array.from(output.data, value => value * 257))).toEqual(expected);
});
