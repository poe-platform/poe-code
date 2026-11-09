import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// RGB8 results from native ImageMagick 7.1.2-35 Q16-HDRI, encoded as PNG24.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ...["Add", "Sum"].flatMap(operation => [
      { operation, tail: ["-evaluate", "Divide", "2"], expected: [150, 150, 80, 150, 80, 146, 80, 146, 150, 146, 150, 150] },
      { operation, tail: ["+clone", "-evaluate-sequence", "Sum", "-evaluate", "Divide", "4"], expected: [150, 150, 80, 150, 80, 146, 80, 146, 150, 146, 150, 150] },
      { operation, tail: [], expected: [255, 255, 160, 255, 160, 255, 160, 255, 255, 255, 255, 255] },
      { operation, tail: ["-clamp", "-evaluate", "Divide", "2"], expected: [128, 128, 80, 128, 80, 128, 80, 128, 128, 128, 128, 128] },
    ]),
    { operation: "Subtract", tail: ["-evaluate", "Add", "50%"], expected: [28, 0, 248, 0, 248, 255, 248, 255, 28, 255, 28, 0] },
    { operation: "Subtract", tail: [], expected: [0, 0, 120, 0, 120, 190, 120, 190, 0, 190, 0, 0] },
    { operation: "Subtract", tail: ["-clamp", "-evaluate", "Add", "50%"], expected: [128, 128, 248, 128, 248, 255, 248, 255, 128, 255, 128, 128] },
  ])(`${mode}: retains $operation range through $tail`, async ({ operation, tail, expected }) => {
    const files = new Map<string, Uint8Array>(), filesystem = createMemoryFileSystem();
    const inputs = [[200, 240, 20, 240, 20, 51, 20, 51, 200, 51, 200, 240], [100, 60, 140, 60, 140, 241, 140, 241, 100, 241, 100, 60]];
    for (const [index, pixels] of inputs.entries()) {
      const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
      files.set(`/in${index}.png`, bytes);
      await filesystem.writeFile(`/in${index}.png`, bytes);
    }
    const args = ["/in0.png", "/in1.png", "-evaluate-sequence", operation, ...tail, "PNG24:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data].filter((_, index) => index % 4 !== 3)).toEqual(expected);
  });
}

for (const retained of [false, true]) {
  it.each([
    { operation: "Add", tail: ["-evaluate", "Divide", "2"], expected: [34867, 20771, 34952, 45498] },
    { operation: "Subtract", tail: ["-evaluate", "Add", "65535", "-evaluate", "Divide", "2"], expected: [15669, 48879, 2476, 26300] },
  ])(`preserves Q16 alpha and range across chunks (retained=${retained}): $operation`, async ({ operation, tail, expected }) => {
    const width = 1031, files = new Map<string, Uint8Array>(), filesystem = createMemoryFileSystem();
    const pixels = [[0xcafe, 0x1234, 0xfedc, 0xcafe], [0x4568, 0x9012, 0x1234, 0x9876]];
    for (const [index, pixel] of pixels.entries()) {
      const data16 = Uint16Array.from({ length: width * 4 }, (_, offset) => pixel[offset % 4]!);
      const bytes = encodeImage({ width, height: 1, format: "png", density: 72, channels: 4, hasAlpha: true, space: "srgb", depth: "ushort",
        data16, data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
      files.set(`/in${index}.png`, bytes);
      await filesystem.writeFile(`/in${index}.png`, bytes);
    }
    const args = ["/in0.png", "/in1.png", "-channel", "RGBA", "-evaluate-sequence", operation, ...tail, "PNG64:/out.png"];
    const result = await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect(output.data16).toEqual(Uint16Array.from({ length: width * 4 }, (_, offset) => expected[offset % 4]!));
  });
}
