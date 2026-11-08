import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    it.each([["PNG8", 8, 3], ["PNG24", 8, 2], ["PNG32", 8, 6], ["PNG48", 16, 2], ["PNG64", 16, 6], ["PNG00", 8, 2]] as const)(`encodes %s at the requested path, retained=${retained}, write=${write}`, async (coder, depth, color) => {
      const pixels = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
      const source = encodeImage({ width: 2, height: 1, density: 72, data: pixels, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar" }, { format: "png" }).data;
      const files = new Map([["/input.png", source]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", source);
      const output = `${coder}:/output.png`;
      const result = await runConvertCli(["/input.png", ...(write ? ["-write", output, "null:"] : [output])], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png");
      expect(bytes).toBeDefined();
      expect(Array.from(bytes!.slice(24, 26))).toEqual([depth, color]);
      expect(Array.from(decodeImage(bytes!).data)).toEqual(Array.from(pixels));
    });
  }
}

for (const absolute of [false, true]) {
  it.each([["PNG24", 2], ["PNG32", 6]] as const)(`public command replaces grayscale output with %s, absolute=${absolute}`, async (coder, color) => {
    const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(value => [value, value, value, 255]));
    const source = { width: 4, height: 2, density: 72, data: pixels, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar" } as const;
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work", { recursive: true });
    await fs.writeFile("/work/input.png", encodeImage(source, { format: "png", pngCoder: "png24" }).data);
    await fs.writeFile("/work/output.png", encodeImage({ ...source, width: 1, height: 1, data: pixels.slice(0, 4) }, { format: "png" }).data);
    const errors: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(["input.png", `${coder}:${absolute ? "/work/" : ""}output.png`]).args,
      cwd: "/work", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } }
    });
    expect(Buffer.concat(errors).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect((await fs.readdir("/work")).map(entry => entry.name).sort()).toEqual(["input.png", "output.png"]);
    const bytes = await fs.readFile("/work/output.png");
    expect(Array.from(bytes.slice(24, 26))).toEqual([8, color]);
    const image = decodeImage(bytes);
    expect([image.width, image.height]).toEqual([4, 2]);
    expect(image.data).toEqual(pixels);
  });
}

// Native ImageMagick PNG64 from Q16 RGBA 123456789abc4567fedcba987654ffff.
const highDepth = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAGklEQVQI12MQMgmrmLXHNf3fnV0zykL+/wcAP78JC0f6r2oAAAAASUVORK5CYII=", "base64");
for (const retained of [false, true]) {
  it.each([
    ["png8", 8, 3, [65535, 65535, 65535, 0, 0xfefe, 0xbaba, 0x7676, 65535]],
    ["png48", 16, 2, [0x1234, 0x5678, 0x9abc, 65535, 0xfedc, 0xba98, 0x7654, 65535]],
    ["png64", 16, 6, [0x1234, 0x5678, 0x9abc, 0x4567, 0xfedc, 0xba98, 0x7654, 65535]],
    ["png00", 16, 6, [0x1234, 0x5678, 0x9abc, 0x4567, 0xfedc, 0xba98, 0x7654, 65535]],
  ] as const)(`preserves native depth and alpha semantics for %s, retained=${retained}`, async (coder, depth, color, expected) => {
    const files = new Map([["/input.png", new Uint8Array(highDepth)]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", highDepth);
    const result = await runConvertCli(["/input.png", `${coder}:-`], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(Array.from(result.stdoutBytes!.slice(24, 26))).toEqual([depth, color]);
    const image = decodeImage(result.stdoutBytes!);
    expect(Array.from(image.data16 ?? Uint16Array.from(image.data, value => value * 257))).toEqual(expected);
  });
}

it.each([["PNG8", 8, 3], ["PNG48", 16, 2], ["PNG64", 16, 6], ["PNG00", 16, 6]] as const)("public command resolves %s before creating the file", async (coder, depth, color) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", highDepth);
  const errors: Uint8Array[] = [];
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(["input.png", `${coder}:output.png`]).args,
    cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } }
  });
  expect(Buffer.concat(errors).toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input.png", "output.png"]);
  expect(Array.from((await fs.readFile("/output.png")).slice(24, 26))).toEqual([depth, color]);
});
