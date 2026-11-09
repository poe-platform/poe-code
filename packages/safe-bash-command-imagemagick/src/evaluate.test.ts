import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI, RGBA [100,150,200,160], -depth 8 rgba:-.
for (const mode of ["buffered", "retained", "sync"] as const) {
  // ImageMagick 7.1.2-31 Q16-HDRI: direct Median adds the operand in quantum units.
  it.each([
    ["50%", [], [168, 228, 255, 192]],
    ["32767.5", [], [168, 228, 255, 192]],
    ["257", [], [41, 101, 181, 65]],
    ["0", [], [40, 100, 180, 64]],
    ["-25%", [], [0, 36, 116, 0]],
    ["-257", [], [39, 99, 179, 63]],
    ["100%", [], [255, 255, 255, 255]],
    ["50%", ["-channel", "RGB"], [168, 228, 255, 64]],
    ["50%", ["-channel", "A"], [40, 100, 180, 192]],
  ] as const)(`${mode}: Median %s matches native with channels %j`, async (operand, channel, expected) => {
    const bytes = await sharp(new Uint8Array([40, 100, 180, 64]), {
      raw: { width: 1, height: 1, channels: 4 },
    }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const args = ["/in.png", ...channel, "-evaluate", "Median", operand, "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual(expected);
  });

  for (const operation of ["RMS", "RootMeanSquare"]) {
    // ImageMagick 7.1.2-31 Q16-HDRI squares quantum values and adds the operand.
    it.each([
      [[40, 100, 180, 64], "0.5", [], [255, 255, 255, 255]],
      [[0, 1, 2, 15], "0", [], [0, 255, 255, 255]],
      [[0, 1, 2, 15], "257", [], [1, 255, 255, 255]],
      [[0, 1, 2, 15], "50%", [], [128, 255, 255, 255]],
      [[0, 1, 2, 15], "-65535", [], [0, 2, 255, 255]],
      [[0, 1, 2, 15], "-100%", [], [0, 2, 255, 255]],
      [[40, 100, 180, 64], "0.5", ["-channel", "RGB"], [255, 255, 255, 64]],
      [[40, 100, 180, 64], "0.5", ["-channel", "A"], [40, 100, 180, 255]],
    ] as const)(`${mode}: ${operation} pixels %j operand %s channels %j matches native`, async (pixels, operand, channel, expected) => {
      const bytes = await sharp(new Uint8Array(pixels), {
        raw: { width: 1, height: 1, channels: 4 },
      }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", ...channel, "-evaluate", operation, operand, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      expect([...output.data]).toEqual(expected);
    });
  }

  for (const operation of ["Exp", "Exponential"]) {
    // ImageMagick 7.1.2-32 Q16-HDRI, RGBA [40,100,180,64], -depth 8 RGBA:-.
    it.each([
      ["0.5", [], [255, 255, 255, 255]],
      ["0", [], [255, 255, 255, 255]],
      ["-0.5", [], [236, 210, 179, 225]],
      ["-2", [], [186, 116, 62, 154]],
      ["-0.001%", [], [230, 197, 161, 216]],
      ["-2", ["-channel", "R"], [186, 100, 180, 64]],
      ["-2", ["-channel", "A"], [40, 100, 180, 154]],
      ["-2", ["-channel", "RGB"], [186, 116, 62, 64]],
    ] as const)(`${mode}: ${operation} %s matches native with channels %j`, async (operand, channel, expected) => {
      const bytes = await sharp(new Uint8Array([40, 100, 180, 64]), {
        raw: { width: 1, height: 1, channels: 4 },
      }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", ...channel, "-evaluate", operation, operand, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      expect([...output.data]).toEqual(expected);
    });
  }

  for (const channel of [[], ["-channel", "Black"]]) {
    it.each(["Bogus", "Absolute"])(`${mode}: rejects %s with channels ${channel.join(" ")} before writing output`, async (operation) => {
      const bytes = await sharp(new Uint8Array([100, 150, 200, 255]), {
        raw: { width: 1, height: 1, channels: 4 },
      }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", ...channel, "-evaluate", operation, "2", "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`unrecognized evaluate operator '-evaluate' '${operation}'`);
      expect(files.has("/out.png")).toBe(false);
      await expect(filesystem.readFile("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
    });
  }

  // ImageMagick 7.1.2-32: aliases evaluate every default channel, including alpha.
  it.each([
    ["Sin", [245, 3, 195, 126]],
    ["Sine", [245, 3, 195, 126]],
    ["Cos", [78, 155, 19, 0]],
    ["Cosine", [78, 155, 19, 0]],
  ] as const)(`${mode}: %s matches native RGBA evaluation`, async (operation, expected) => {
    const bytes = await sharp(new Uint8Array([40, 100, 180, 64]), {
      raw: { width: 1, height: 1, channels: 4 },
    }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const args = ["/in.png", "-evaluate", operation, "2", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual(expected);
  });

  // Native Q16-HDRI trigonometric percentages use 65536, not QuantumRange (65535).
  it.each([
    ["50%", [101, 7, 103], [3, 87, 253]],
    ["32768", [101, 7, 103], [3, 87, 253]],
    ["32767.5", [128, 128, 128], [0, 0, 0]],
    ["0.5", [154, 248, 152], [252, 168, 2]],
    ["25%", [254, 231, 115], [114, 53, 254]],
    ["12.3%", [206, 0, 228], [27, 135, 206]],
    ["-50%", [154, 248, 152], [3, 87, 253]],
    ["100%", [179, 205, 79], [244, 26, 245]],
  ] as const)(`${mode}: trigonometric operand %s matches native evaluation`, async (operand, sine, cosine) => {
    const pixels = new Uint8Array([17, 101, 239].flatMap(value => [value, value, value, 255]));
    const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    for (const [operation, expected] of [["Sine", sine], ["Sin", sine], ["Cosine", cosine], ["Cos", cosine]] as const) {
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", "-channel", "RGB", "-evaluate", operation, operand, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      const rgba = expected.flatMap(value => [value, value, value, 255]);
      if (operand === "32767.5") {
        // Sine lands at 127.5 here; native and JS floating-point rounding can differ by one byte.
        expect(output.data).toHaveLength(rgba.length);
        rgba.forEach((value, index) => expect(Math.abs(output.data[index]! - value)).toBeLessThanOrEqual(index % 4 === 3 ? 0 : 1));
      } else {
        expect([...output.data]).toEqual(rgba);
      }
    }
  });

  for (const [operation, integer, percentage] of [
    ["And", [1, 1, 4], [0, 0, 128]],
    ["Or", [20, 104, 239], [145, 229, 239]],
    ["Xor", [19, 102, 235], [145, 229, 111]],
  ] as const) {
    it.each(["1000", "50%", "32767.5"])(`${mode}: ${operation} %s matches native Q16 bitwise evaluation`, async (operand) => {
      const pixels = new Uint8Array([17, 101, 239].flatMap(value => [value, value, value, 255]));
      const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", "-channel", "RGB", "-evaluate", operation, operand, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      const expected = operand === "1000" ? integer : percentage;
      expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
  }

  // Native Q16: 50% is the quantum operand 32767.5, not the factor 0.5.
  for (const [operation, percentage, fractional] of [
    ["Multiply", [255, 255, 255], [9, 51, 120]],
    ["Divide", [0, 0, 0], [34, 202, 255]],
    ["Pow", [0, 0, 0], [66, 160, 247]],
    ["Log", [189, 232, 253], [21, 114, 242]],
  ] as const) {
    it.each(["50%", "32767.5", "0.5"])(`${mode}: ${operation} %s matches native Q16 operands`, async (operand) => {
      const pixels = new Uint8Array([17, 101, 239].flatMap(value => [value, value, value, 255]));
      const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", "-channel", "RGB", "-evaluate", operation, operand, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      const expected = operand === "0.5" ? fractional : percentage;
      expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
  }

  for (const operation of ["LeftShift", "RightShift"]) {
    // ImageMagick 7.1.2-35 Q16-HDRI treats negative shift counts as zero.
    it.each([-2, -1, 0])(`${mode}: ${operation} %i leaves pixels unchanged`, async (shift) => {
      const pixels = new Uint8Array([0, 1, 32, 64, 127, 128, 192, 254, 255].flatMap(value => [value, value, value, 255]));
      const bytes = await sharp(pixels, { raw: { width: 9, height: 1, channels: 4 } }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", "-evaluate", operation, String(shift), "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      expect([...output.data]).toEqual([...pixels]);
    });
  }

  it.each([
    [0, [17, 101, 239]],
    [1, [9, 51, 120]],
    [1.5, [9, 51, 120]],
    [2, [4, 25, 60]],
    [8, [0, 0, 1]],
    [16, [0, 0, 0]],
    [32, [0, 0, 0]],
    [100, [0, 0, 0]],
    [1024, [0, 0, 0]],
  ])(`${mode}: RightShift %s matches native rounding and shift width`, async (shift, expected) => {
    const pixels = new Uint8Array([17, 101, 239].flatMap(value => [value, value, value, 255]));
    const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const args = ["/in.png", "-channel", "RGB", "-evaluate", "RightShift", String(shift), "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
  });

  it.each([2, 24, 256, 1024, 1025, 32768, "50%"])(`${mode}: LeftShift %s clamps overflowing channels`, async (shift) => {
    const values = [0, 40, 63, 64, 100, 200, 255];
    const pixels = new Uint8Array(values.flatMap(value => [value, value, value, 255]));
    const bytes = await sharp(pixels, { raw: { width: values.length, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const args = ["/in.png", "-channel", "RGB", "-evaluate", "LeftShift", String(shift), "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    const expected = shift === 2 ? [0, 160, 252, 255, 255, 255, 255] : [0, 255, 255, 255, 255, 255, 255];
    expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
  });

  for (const [operation, value, expected] of [
    ["Multiply", "0.5", [50, 75, 100, 80]],
    ["Divide", "2", [50, 75, 100, 80]],
    ["Pow", "2", [39, 88, 157, 100]],
  ] as const) {
    it.each([
      [[], expected[3]],
      [["-channel", "RGB"], 160],
      [["-channel", "RGBA"], expected[3]],
      [["-channel", "RGB", "+channel"], expected[3]],
      [["-alpha", "off"], 255],
    ] as const)(`${mode}: ${operation} ${value} matches native channel selection %j`, async (channel, alpha) => {
      const bytes = await sharp(new Uint8Array([100, 150, 200, 160]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", ...channel, "-evaluate", operation, value, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      expect([...output.data]).toEqual([...expected.slice(0, 3), alpha]);
    });
  }
}

for (const mode of ["map", "retained", "command"] as const) {
  it.each([
    ["Add", "0", 9],
    ["Add", "0.5", 9],
    ["Add", "1", 9],
    ["Add", "10", 9],
    ["Add", "254", 10],
    ["Add", "255", 10],
    ["Add", "256", 10],
    ["Add", "257", 10],
    ["Add", "-10", 9],
    ["Add", "-257", 8],
    ["Add", "10%", 35],
    ["Multiply", "0.5", 5],
  ])(`${mode}: evaluates %s %s in Q16 units or operation factors`, async (operation, value, red) => {
    const pixels = new Uint8Array([9, 15, 21, 255, 109, 115, 121, 255]);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.png", bytes);
    const args = ["/in.png", "-channel", "R", "-evaluate", operation, value, "+channel", "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual([red, 15, 21, 255, operation === "Multiply" ? 55 : red + 100, 115, 121, 255]);
  });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI saturates nonzero samples at these counts.
it.each(["1024", "1025", "32768", "50%"])("command: LeftShift %s saturates the grayscale ramp", async (shift) => {
  const values = [0, 1, 32, 64, 127, 128, 192, 254, 255];
  const pixels = new Uint8Array(values.flatMap(value => [value, value, value, 255]));
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.png", await sharp(pixels, { raw: { width: values.length, height: 1, channels: 4 } }).png().toBuffer());
  const args = ["/in.png", "-evaluate", "LeftShift", shift, "/out.png"];
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  });
  expect(result).toMatchObject({ exitCode: 0 });
  const output = decodeImage(await fs.readFile("/out.png"));
  expect([...output.data]).toEqual(values.flatMap(value => value === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
});
