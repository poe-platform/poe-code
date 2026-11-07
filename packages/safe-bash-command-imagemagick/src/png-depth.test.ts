import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick PNG48: two pixels with distinct high and low channel bytes.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLXnzYoUhTszACHGBfjAwcGSAAAAAElFTkSuQmCC", "base64");

for (const retained of [false, true]) {
  it(`preserves 16-bit PNG channels through no-op conversion, retained=${retained}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const files = new Map([["/input.png", new Uint8Array(input)]]);
    expect(await runConvertCli(["/input.png", "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(output[24]).toBe(16);
    expect(Array.from(decodeImage(output).data16!)).toEqual([
      0x1234, 0x5678, 0x9abc, 0xffff, 0xfedc, 0xba98, 0x7654, 0xffff
    ]);
  });
}

for (const retained of [false, true]) {
  it.each([
    [["-evaluate", "add", "1"], [0x1235, 0x5679, 0x9abd, 0xffff, 0x1236, 0x5679, 0x9abd, 0xffff]],
    [["-negate"], [0xedcb, 0xa987, 0x6543, 0xffff, 0xedca, 0xa987, 0x6543, 0xffff]],
    [["-channel", "R", "-evaluate", "add", "1"], [0x1235, 0x5678, 0x9abc, 0xffff, 0x1236, 0x5678, 0x9abc, 0xffff]],
    [["-channel", "R", "-negate"], [0xedcb, 0x5678, 0x9abc, 0xffff, 0xedca, 0x5678, 0x9abc, 0xffff]],
    [["-evaluate", "add", "65535"], [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535]],
    [["-evaluate", "add", "-65535"], [0, 0, 0, 65535, 0, 0, 0, 65535]],
    [["-negate", "-evaluate", "add", "1"], [0xedcc, 0xa988, 0x6544, 0xffff, 0xedcb, 0xa988, 0x6544, 0xffff]],
  ] as [string[], number[]][])('computes Q16 pixels for %j, retained=' + retained, async (args, expected) => {
    const image = decodeImage(input);
    image.data16!.set([0x1235, 0x5678, 0x9abc, 0xffff], 4);
    const source = encodeImage(image, { format: "png" }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const files = new Map([["/input.png", source]]);
    expect(await runConvertCli(["/input.png", ...args, "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(decodeImage(output).data16 ?? [])).toEqual(expected);
    expect(output[24]).toBe(16);
  });
}

for (const retained of [false, true]) {
  it.each([
    [["-channel", "A", "-evaluate", "add", "1"], [0x1234, 0x1234, 0x1234, 0x4568, 0x1234, 0x1235, 0x1234, 0x4568]],
    [["-channel", "RGB", "+negate"], [0xedcb, 0xedcb, 0xedcb, 0x4567, 0x1234, 0x1235, 0x1234, 0x4567]],
    [["-channel", "A", "-negate"], [0x1234, 0x1234, 0x1234, 0xba98, 0x1234, 0x1235, 0x1234, 0xba98]],
    [["-channel", "A", "-evaluate", "add", "20%"], [0x1234, 0x1234, 0x1234, 0x789a, 0x1234, 0x1235, 0x1234, 0x789a]],
  ] as [string[], number[]][])('preserves Q16 alpha and gray selection for %j, retained=' + retained, async (args, expected) => {
    const data16 = Uint16Array.from([0x1234, 0x1234, 0x1234, 0x4567, 0x1234, 0x1235, 0x1234, 0x4567]);
    const source = encodeImage({ ...decodeImage(input), hasAlpha: true, channels: 4, data16,
      data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const files = new Map([["/input.png", source]]);
    expect(await runConvertCli(["/input.png", ...args, "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(decodeImage(output).data16 ?? [])).toEqual(expected);
    expect(output[24]).toBe(16);
  });
}
