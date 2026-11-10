import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG24 inputs, -depth 8 rgba:-.
for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const { operation, combined } of [
    { operation: "AddModulus", combined: [58, 20, 218, 255] },
    { operation: "Mean", combined: [104, 92, 158, 255] },
  ]) {
    it.each([
      { count: 1, reverse: false, expected: [36, 108, 201, 255] },
      { count: 3, reverse: false, expected: combined },
      { count: 3, reverse: true, expected: combined },
    ])(`${mode}: ${operation} with $count inputs (reverse=$reverse) matches native`, async ({ count, reverse, expected }) => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const paths: string[] = [];
      for (const pixel of [[36, 108, 201], [83, 17, 223], [194, 150, 49]].slice(0, count)) {
        const path = `/input${paths.length}.png`;
        const bytes = await sharp(new Uint8Array(pixel), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
        paths.push(path);
      }
      if (reverse) paths.reverse();
      const args = [...paths, "-evaluate-sequence", operation, "/out.png"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
      expect([...output.data]).toEqual(expected);
    });
  }
}

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit PPM inputs, raw RGB output.
for (const mode of ["map", "sync", "retained", "command"] as const)
it.each([
  { operation: "AddModulus", count: 2, depth: 16, expected: "41416767aaaa5e5d2322f1f1" },
  { operation: "AddModulus", count: 2, depth: 8, expected: "4167aa5e23f1" },
  { operation: "AddModulus", count: 1, depth: 16, expected: "0d0d1e1e4f4febeb99993d3d" },
  { operation: "Sum", count: 2, depth: 16, expected: "41416767aaaafffffffff1f1" },
])(`${mode}: $operation preserves wrapped Q16 samples ($count inputs, depth $depth)`, async ({ operation, count, depth, expected }) => {
  const files = new Map([
    ["/a.ppm", new TextEncoder().encode("P3\n2 1\n255\n13 30 79 235 153 61\n")],
    ["/c.ppm", new TextEncoder().encode("P3\n2 1\n255\n52 73 91 114 137 180\n")],
    ["/out", new TextEncoder().encode("KEEP")],
  ]);
  const fs = createMemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = [...["/a.ppm", "/c.ppm"].slice(0, count), "-evaluate-sequence", operation,
    "-endian", "MSB", "-depth", String(depth), "rgb:/out"];
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
  }) : mode === "sync" ? runConvertCliSync(args, files)
    : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0 });
  const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
  expect(Buffer.from(output).toString("hex")).toBe(expected);
});
