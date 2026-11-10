import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  it.each([
    [[], [106, 90, 106]],
    [["-virtual-pixel", "black"], [88, 38, 20]],
    [["-virtual-pixel", "white"], [216, 166, 148]],
    [["-virtual-pixel", "gray"], [152, 102, 84]],
    [["-background", "#204060", "-virtual-pixel", "background"], [104, 70, 68]],
    [["-virtual-pixel", "transparent"], [88, 38, 20]],
    [["-virtual-pixel", "white", "+virtual-pixel"], [106, 90, 106]],
  ] as const)(`${mode}: evaluates smaller images using virtual pixels %j`, async (settings, outside) => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    for (const [path, width, height, background] of [["/a.png", 1, 1, "#2468ac"], ["/big.png", 3, 2, "#b04c28"]] as const) {
      const bytes = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/a.png", "/big.png", ...settings, "-evaluate-sequence", "Mean", "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([3, 2]);
    expect(Array.from(output.data)).toEqual([106, 90, 106, 255, ...Array.from({ length: 5 }, () => [...outside, settings.some(value => value === "transparent") ? 128 : 255]).flat()]);
  });
}

for (const mode of ["map", "retained"] as const) {
  it.each(["tile", "mirror"])(`${mode}: repeats a patterned grid with %s virtual pixels`, async method => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const source = [20, 40, 60, 80];
    for (const [path, width, height, values] of [["/small.png", 2, 2, source], ["/big.png", 7, 5, Array(35).fill(0)]] as const) {
      const data = Uint8Array.from(values.flatMap(value => [value, value, value]));
      const bytes = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
      files.set(path, bytes); await fs.writeFile(path, bytes);
    }
    const args = ["/small.png", "/big.png", "-virtual-pixel", method, "-evaluate-sequence", "Mean", "/out.png"];
    expect((await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const coordinates = method === "tile" ? [0, 1, 0, 1, 0, 1, 0] : [0, 1, 1, 0, 0, 1, 1];
    expect(Array.from(output.data)).toEqual(Array.from({ length: 35 }, (_, pixel) => {
      const value = source[coordinates[Math.floor(pixel / 7)]! * 2 + coordinates[pixel % 7]!]! / 2;
      return [value, value, value, 255];
    }).flat());
  });
}

for (const mode of ["map", "retained", "command"] as const) {
  // Native ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
  it.each([
    ["gray", "b", "8", "213455b58c5e79849a808080"],
    ["gray", "b", "16", "20a133b45555b5f58ccc5e9e793984c49a5a800080008000"],
    ["edge", "b", "8", "21345590714c405482af9179"],
    ["black", "b", "8", "213455764d1f39455a000000"],
    ["gray", "c", "8", "213455af9179"],
  ])(`${mode}: averages row and column with %s virtual pixels (%s, depth %s)`, async (method, second, depth, expected) => {
    const files = new Map(Object.entries({
      "/a.ppm": "P3\n2 1\n255\n13 30 79 235 153 61\n",
      "/b.ppm": "P3\n1 2\n255\n52 73 91 114 137 180\n",
      "/c.ppm": "P3\n2 1\n255\n52 73 91 114 137 180\n",
      "/out": "KEEP",
    }).map(([path, text]) => [path, new TextEncoder().encode(text)]));
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["-virtual-pixel", method!, "/a.ppm", `/${second}.ppm`, "-evaluate-sequence", "Mean", "-depth", depth!, "-endian", "MSB", "rgb:/out"];
    const result = mode === "command"
      ? await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(mode === "map" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
  });
}
