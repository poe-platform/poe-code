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

for (const retained of [false, true]) {
  it.each([
    [["/input.png", "+append"], [0x1234, 0x5678, 0x9abc, 65535, 0xfedc, 0xba98, 0x7654, 65535, 0x1234, 0x5678, 0x9abc, 65535, 0xfedc, 0xba98, 0x7654, 65535]],
    [["/input.png", "-append"], [0x1234, 0x5678, 0x9abc, 65535, 0xfedc, 0xba98, 0x7654, 65535, 0x1234, 0x5678, 0x9abc, 65535, 0xfedc, 0xba98, 0x7654, 65535]],
    [["-gravity", "east", "-extent", "1x1"], [0xfedc, 0xba98, 0x7654, 65535]],
    [["-background", "black", "-extent", "3x1"], [0x1234, 0x5678, 0x9abc, 65535, 0xfedc, 0xba98, 0x7654, 65535, 0, 0, 0, 65535]],
  ] as [string[], number[]][])('preserves Q16 canvas samples for %j, retained=' + retained, async (args, expected) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const files = new Map([["/input.png", new Uint8Array(input)]]);
    expect(await runConvertCli(["/input.png", ...args, "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(decodeImage(output).data16 ?? [])).toEqual(expected);
    expect(output[24]).toBe(16);
  });
}

for (const retained of [false, true]) {
  it.each([false, true])('promotes mixed-depth append in either order, lowDepthFirst=%s, retained=' + retained, async lowDepthFirst => {
    const image = decodeImage(input);
    const { data16: ignored, ...lowImage } = image;
    const low = encodeImage({ ...lowImage, width: 1, data: Uint8Array.from([17, 34, 51, 255]) }, { format: "png" }).data;
    const files = new Map([["/input.png", new Uint8Array(input)], ["/low.png", low]]);
    const fs = new MemoryFileSystem();
    for (const [path, data] of files) await fs.writeFile(path, data);
    const paths = lowDepthFirst ? ["/low.png", "/input.png"] : ["/input.png", "/low.png"];
    expect(await runConvertCli([...paths, "-background", "black", "-gravity", "east", "-append", "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    const lowRow = [0, 0, 0, 65535, 0x1111, 0x2222, 0x3333, 65535];
    const highRow = Array.from(image.data16!);
    expect(Array.from(decodeImage(output).data16 ?? [])).toEqual(lowDepthFirst ? [...lowRow, ...highRow] : [...highRow, ...lowRow]);
    expect(output[24]).toBe(16);
  });

  it.each(["+append", "-extent"])('preserves Q16 alpha with transparent background for %s, retained=' + retained, async operation => {
    const data16 = Uint16Array.from([0x1234, 0x5678, 0x9abc, 0x4567, 0xfedc, 0xba98, 0x7654, 65535]);
    const source = encodeImage({ ...decodeImage(input), hasAlpha: true, channels: 4, data16,
      data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const args = operation === "+append" ? ["/input.png", "+append"] : ["-extent", "3x1"];
    expect(await runConvertCli(["/input.png", "-background", "none", ...args, "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(decodeImage(output).data16 ?? [])).toEqual([...data16, ...(operation === "+append" ? data16 : [0, 0, 0, 0])]);
    expect(output[24]).toBe(16);
  });
}
