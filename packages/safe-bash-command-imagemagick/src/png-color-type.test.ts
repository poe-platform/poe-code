import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runConvertCli } from "./index.js";

// Native ImageMagick PNG24, opaque red and blue pixels.
const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcICjKtJ3NeAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA4OjEwOjUwKzAwOjAw4nx90AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwODoxMDo1MCswMDowMJMhxWwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDg6MTA6NTArMDA6MDDENOSzAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");
for (const retained of [false, true]) {
  for (const write of [false, true]) {
    it.each([2, 6])(`honors color type %s, retained=${retained}, write=${write}`, async color => {
      const files = new Map([["/input.png", source]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", source);
      const args = ["/input.png", "-define", `png:color-type=${color}`, ...(write ? ["-write", "/output.png", "null:"] : ["/output.png"])];
      const result = await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
      expect(Array.from(bytes.slice(24, 26))).toEqual([8, color]);
      expect(Array.from(decodeImage(bytes).data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    });
  }
  it(`warns and ignores invalid color type, retained=${retained}`, async () => {
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", "-define", "png:color-type=7", "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("ignoring invalid defined png:color-type =7");
    const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(bytes.slice(24, 26))).toEqual([1, 3]);
  });
}
it("public command preserves opaque pixels in requested RGBA output", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", source);
  const errors: Uint8Array[] = [];
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(["input.png", "-define", "png:color-type=6", "output.png"]).args,
    cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } }
  });
  expect(result.exitCode).toBe(0);
  expect(Buffer.concat(errors).toString()).toBe("");
  const bytes = await fs.readFile("/output.png");
  expect(Array.from(bytes.slice(24, 26))).toEqual([8, 6]);
  expect(Array.from(decodeImage(bytes).data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
});

for (const retained of [false, true]) {
  it(`captures the color type at each write, retained=${retained}`, async () => {
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", "-define", "png:color-type=6", "-write", "/rgba.png", "-define", "png:color-type=2", "/rgb.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    for (const [path, color] of [["/rgba.png", 6], ["/rgb.png", 2]] as const) {
      const bytes = retained ? await fs.readFile(path) : files.get(path)!;
      expect(bytes[25]).toBe(color);
    }
  });
  it(`retains explicit 16-bit depth with RGBA, retained=${retained}`, async () => {
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", "-define", "png:bit-depth=16", "-define", "png:color-type=6", "png:-"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(Array.from(result.stdoutBytes!.slice(24, 26))).toEqual([16, 6]);
    expect(Array.from(decodeImage(result.stdoutBytes!).data16!)).toEqual([65535, 0, 0, 65535, 0, 0, 65535, 65535]);
  });
  it(`compare warns about an invalid color type, retained=${retained}`, async () => {
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runCompareCli(["/input.png", "/input.png", "-define", "png:color-type=7", "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("ignoring invalid defined png:color-type =7");
  });
}

const graySource = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQAAAADcWUInAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oLBwgOAu+ShvYAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDg6MTQ6MDIrMDA6MDA06MLnAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA4OjE0OjAyKzAwOjAwRbV6WwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwODoxNDowMiswMDowMBKgW4QAAAAKSURBVAjXY3AAAABCAEGDueytAAAAAElFTkSuQmCC", "base64");
for (const retained of [false, true]) {
  it.each([0, 2, 3, 4, 6])(`selects legal color type %s for grayscale input, retained=${retained}`, async color => {
    const files = new Map([["/input.png", graySource]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", graySource);
    const result = await runConvertCli(["/input.png", "-define", `png:color-type=${color}`, "png:-"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdoutBytes![25]).toBe(color);
    expect(Array.from(decodeImage(result.stdoutBytes!).data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
}

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    for (const regardWarnings of [false, true]) {
      it.each([0, 4])(`warns on grayscale fallback %s, retained=${retained}, write=${write}, regard=${regardWarnings}`, async color => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["xc:red", ...(regardWarnings ? ["-regard-warnings"] : []), "-define", `png:color-type=${color}`, ...(write ? ["-write", "/output.png", "null:"] : ["/output.png"])], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.stderr).toContain("Cannot write image with defined png:bit-depth or png:color-type");
        expect(result.exitCode).toBe(regardWarnings ? 1 : 0);
        const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
        expect(Array.from(bytes.slice(24, 26))).toEqual([8, color === 0 ? 2 : 6]);
        expect(Array.from(decodeImage(bytes).data)).toEqual([255, 0, 0, 255]);
      });
    }
  }
}

for (const input of ["xc:red", "xc:gray50"]) {
  it.each([0, 4])(`public command reports grayscale fallback %s for ${input}`, async color => {
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
      command: "magick", args: createCommandArguments([input, "-regard-warnings", "-define", `png:color-type=${color}`, "png:-"]).args,
      cwd: "/", env: {}, fs: new MemoryFileSystem(), stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { output.push(bytes); } }, stderr: { async write(bytes) { errors.push(bytes); } }
    });
    const fallback = input === "xc:red";
    expect(result.exitCode).toBe(fallback ? 1 : 0);
    expect(Buffer.concat(errors).toString()).toBe(fallback ? "magick: Cannot write image with defined png:bit-depth or png:color-type\n" : "");
    const bytes = Buffer.concat(output);
    expect(Array.from(bytes.slice(24, 26))).toEqual([8, fallback ? color === 0 ? 2 : 6 : color]);
    expect(Array.from(decodeImage(bytes).data)).toEqual(fallback ? [255, 0, 0, 255] : [127, 127, 127, 255]);
  });
}

for (const retained of [false, true]) {
  it(`warns for each split PNG frame, retained=${retained}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["xc:red", "xc:gray50", "-regard-warnings", "-define", "png:color-type=0", "/output-%d.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("magick: Cannot write image with defined png:bit-depth or png:color-type\n");
    for (const [path, color] of [["/output-0.png", 2], ["/output-1.png", 0]] as const) {
      expect((retained ? await fs.readFile(path) : files.get(path)!)[25]).toBe(color);
    }
  });
  it("does not warn when an explicit PNG coder overrides the color type", async () => {
    const result = await runConvertCli(["xc:red", "-regard-warnings", "-define", "png:color-type=0", "png24:-"], retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdoutBytes![25]).toBe(2);
  });
}
