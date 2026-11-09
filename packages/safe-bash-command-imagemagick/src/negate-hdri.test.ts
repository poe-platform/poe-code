import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: PNG64 output decoded as 16-bit MSB RGBA.
const data16 = Uint16Array.from([
  65535, 65535, 65535, 65535, 16385, 16385, 16385, 32769,
  16385, 16386, 16385, 32769, 0, 0, 0, 0,
]);
const input = encodeImage({ width: 4, height: 1, format: "png", density: 72,
  channels: 4, hasAlpha: true, space: "srgb", depth: "ushort", data16,
  data: Uint8Array.from(data16, value => Math.round(value / 257)),
}, { format: "png" }).data;

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { operations: ["-channel", "R", "-evaluate", "Add", "0.25", "+channel", "+negate"],
      expected: [65535, 65535, 65535, 65535, 16385, 16385, 16385, 32769, 16385, 16386, 16385, 32769, 0, 0, 0, 0] },
    { operations: ["-evaluate", "Add", "10000", "-negate", "-evaluate", "Add", "10000"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 49150, 49149, 49150, 32766, 65535, 65535, 65535, 65535] },
    { operations: ["-evaluate", "Subtract", "10000", "-negate", "-evaluate", "Subtract", "10000"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 49150, 49149, 49150, 32766, 65535, 65535, 65535, 65535] },
    { operations: ["-evaluate", "Add", "0.25", "-negate", "-evaluate", "Add", "0.5"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 49150, 49149, 49150, 32766, 65535, 65535, 65535, 65535] },
    { operations: ["-channel", "R", "-evaluate", "Add", "0.25", "+channel", "-negate"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 49150, 49149, 49150, 32766, 65535, 65535, 65535, 65535] },
    { operations: ["-channel", "R", "-evaluate", "Add", "0", "+channel", "+negate"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 16385, 16386, 16385, 32769, 65535, 65535, 65535, 65535] },
    { operations: ["-evaluate", "Add", "10000", "-clamp", "-negate", "-evaluate", "Add", "10000"],
      expected: [10000, 10000, 10000, 10000, 49150, 49150, 49150, 32766, 49150, 49149, 49150, 32766, 65535, 65535, 65535, 65535] },
    { operations: ["-negate"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 49150, 49149, 49150, 32766, 65535, 65535, 65535, 65535] },
    { operations: ["-channel", "R", "-negate"],
      expected: [0, 65535, 65535, 65535, 49150, 16385, 16385, 32769, 49150, 16386, 16385, 32769, 65535, 0, 0, 0] },
    { operations: ["-channel", "A", "-negate"],
      expected: [65535, 65535, 65535, 0, 16385, 16385, 16385, 32766, 16385, 16386, 16385, 32766, 0, 0, 0, 65535] },
    { operations: ["+negate"],
      expected: [0, 0, 0, 0, 49150, 49150, 49150, 32766, 16385, 16386, 16385, 32769, 65535, 65535, 65535, 65535] },
    { operations: ["-channel", "R", "+negate"],
      expected: [0, 65535, 65535, 65535, 49150, 16385, 16385, 32769, 16385, 16386, 16385, 32769, 65535, 0, 0, 0] },
    { operations: ["-channel", "A", "+negate"],
      expected: [65535, 65535, 65535, 0, 16385, 16385, 16385, 32766, 16385, 16386, 16385, 32769, 0, 0, 0, 65535] },
  ])(`${mode}: preserves intermediate samples through $operations`, async ({ operations, expected }) => {
    const files = new Map([["/in.png", input]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", ...operations, "PNG64:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(Array.from(decodeImage(output).data16!)).toEqual(expected);
  });
}
