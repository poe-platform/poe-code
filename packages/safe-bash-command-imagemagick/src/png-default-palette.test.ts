import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcICjKtJ3NeAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA4OjEwOjUwKzAwOjAw4nx90AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwODoxMDo1MCswMDowMJMhxWwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDg6MTA6NTArMDA6MDDENOSzAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");

for (const mode of ["memory", "retained", "public"]) {
  for (const flop of [false, true]) {
    it(`selects a lossless one-bit palette, mode=${mode}, flop=${flop}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", source);
      const files = new Map([["/input.png", source]]);
      const args = ["/input.png", ...(flop ? ["-flop"] : []), "/output.png"];
      const result = mode === "public" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} }
      }) : await runConvertCli(args, mode === "memory" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      const bytes = mode === "memory" ? files.get("/output.png")! : await fs.readFile("/output.png");
      expect(Array.from(bytes.slice(24, 26))).toEqual([1, 3]);
      expect(Array.from(decodeImage(bytes).data)).toEqual(flop ? [0, 0, 255, 255, 255, 0, 0, 255] : [255, 0, 0, 255, 0, 0, 255, 255]);
    });
  }
}

for (const retained of [false, true]) {
  it.each([2, 3, 5, 17, 256, 257])(`packs odd-width rows across storage chunks without losing colors, retained=${retained}, colors=%s`, async colors => {
    const width = 1031, height = 2;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const color = i % colors;
      data.set([color & 255, color >>> 8, 123, 255], i * 4);
    }
    const source = encodeImage({ width, height, data, density: 72, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar" }, { format: "png" }).data;
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", "-write", "/output.png", "null:"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(bytes.slice(24, 26))).toEqual([colors <= 2 ? 1 : colors <= 4 ? 2 : colors <= 16 ? 4 : 8, colors <= 256 ? 3 : 2]);
    expect(decodeImage(bytes).data).toEqual(data);
  });
}
