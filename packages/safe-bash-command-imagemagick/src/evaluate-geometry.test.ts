import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACEAIAAABChi0OAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6MjM6NTMrMDA6MDA8Tls5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjIzOjUzKzAwOjAwTRPjhQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODoyMzo1MyswMDowMBoGwloAAAArSURBVAjXY2SAgFSGVIZU/+f+z/2fM5znOM9xnuOTwSeDTwb///////8/ANDYELh87yWQAAAAAElFTkSuQmCC", "base64"));
const values = [0, 101, 20300, 53000, 62000, 65535];
// ImageMagick 7.1.2-35 Q16-HDRI, decoded as 16-bit MSB RGB.
const transforms = [
  { operations: [], width: 3, height: 2, order: [0, 1, 2, 3, 4, 5] },
  { operations: ["-flip"], width: 3, height: 2, order: [3, 4, 5, 0, 1, 2] },
  { operations: ["-flop"], width: 3, height: 2, order: [2, 1, 0, 5, 4, 3] },
  { operations: ["-roll", "+1+0"], width: 3, height: 2, order: [2, 0, 1, 5, 3, 4] },
  { operations: ["-transpose"], width: 2, height: 3, order: [0, 3, 1, 4, 2, 5] },
  { operations: ["-crop", "2x1+1+1", "+repage"], width: 2, height: 1, order: [4, 5] },
  { operations: ["-chop", "1x0+1+0"], width: 2, height: 2, order: [0, 2, 3, 5] },
];

async function convert(mode: string, bytes: Uint8Array, operations: string[]) {
  const fs = createMemoryFileSystem(), files = new Map([["/in.png", bytes]]);
  await fs.writeFile("/in.png", bytes);
  const args = ["/in.png", ...operations, "/out.png"];
  let stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  }) : mode === "sync" ? runConvertCliSync(args, files)
    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
  expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
  return decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
}

for (const mode of ["buffered", "retained", "sync", "command"]) {
  for (const chain of ["standalone", "evaluate", "clamp"]) {
    it.each(transforms)(`${mode} ${chain}: preserves samples through $operations`, async ({ operations, width, height, order }) => {
      const output = await convert(mode, input, chain === "standalone" ? operations : [
        "-evaluate", "Add", "10000", ...(chain === "clamp" ? ["-clamp"] : []),
        ...operations, "-evaluate", "Subtract", "10000",
      ]);
      expect(output).toMatchObject({ width, height });
      const expected = order.flatMap(index => {
        const value = chain === "clamp" ? Math.min(values[index]!, 55535) : values[index]!;
        return [value, value, value, 65535];
      });
      expect(Array.from(output.data16!)).toEqual(expected);
    });
  }
  it.each([
    { operations: ["-shave", "1x1"], width: 4, height: 2, order: [7, 8, 9, 10, 13, 14, 15, 16] },
    { operations: ["-shave", "3x2"], width: 6, height: 4, order: Array.from({ length: 24 }, (_, i) => i) },
    { operations: ["-auto-orient"], width: 4, height: 6, order: [18, 12, 6, 0, 19, 13, 7, 1, 20, 14, 8, 2, 21, 15, 9, 3, 22, 16, 10, 4, 23, 17, 11, 5] },
  ])(`${mode}: retains RGBA through $operations between evaluates`, async ({ operations, width, height, order }) => {
    const data = Uint8Array.from({ length: 6 * 4 * 4 }, (_, i) => (i * 11) % 256);
    const bytes = encodeImage({ width: 6, height: 4, data, format: "png", space: "srgb", channels: 4,
      depth: "uchar", density: 72, hasAlpha: true, orientation: 6 }, { format: "png" }).data;
    const output = await convert(mode, bytes, ["-evaluate", "Add", "0", ...operations, "-evaluate", "Add", "0"]);
    expect(output).toMatchObject({ width, height, ...(operations[0] === "-auto-orient" ? { orientation: 1 } : {}) });
    expect(Array.from(output.data)).toEqual(order.flatMap(i => Array.from(data.subarray(i * 4, i * 4 + 4))));
  });
}

for (const mode of ["buffered", "retained", "sync", "command"]) {
  it.each([false, true])(`${mode}: preserves negative samples across tile and storage boundaries (crop=%s)`, async crop => {
    const width = 67, height = 39;
    const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 11) % 256);
    const bytes = encodeImage({ width, height, data, format: "png", space: "srgb", channels: 4,
      depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const output = await convert(mode, bytes, ["-evaluate", "Subtract", "65535", "-flip",
      ...(crop ? ["-crop", "34x35+2+3", "+repage"] : []), "-evaluate", "Add", "65535"]);
    expect(output).toMatchObject({ width: crop ? 34 : width, height: crop ? 35 : height });
    const expected = new Uint8Array(output.width * output.height * 4);
    for (let y = 0; y < output.height; y++) {
      const start = ((height - 1 - y - (crop ? 3 : 0)) * width + (crop ? 2 : 0)) * 4;
      expected.set(data.subarray(start, start + output.width * 4), y * output.width * 4);
    }
    expect(output.data).toEqual(expected);
  });
}
