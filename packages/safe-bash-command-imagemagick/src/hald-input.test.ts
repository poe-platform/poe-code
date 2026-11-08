import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "command"] as const) {
  for (const level of [2, 3]) {
    it(`${mode}: generates the level ${level} identity Hald lattice`, async () => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      const args = ["-size", "1x1", `hald:${level}`, "/lut.png"];
      const result = mode === "map" ? await runMagickCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      });
      expect(result.exitCode).toBe(0);
      const image = decodeImage(mode === "map" ? files.get("/lut.png")! : await fs.readFile("/lut.png"));
      expect([image.width, image.height]).toEqual([level ** 3, level ** 3]);
      expect(image.depth).toBe(level === 2 ? "uchar" : "ushort");
      const samples = image.data16 ?? image.data;
      const quantum = image.data16 ? 65535 : 255;
      for (let pixel = 0; pixel < level ** 6; pixel++) {
        const side = level ** 2;
        expect(Array.from(samples.subarray(pixel * 4, pixel * 4 + 4))).toEqual([
          Math.round((pixel % side) * quantum / (side - 1)),
          Math.round((Math.floor(pixel / side) % side) * quantum / (side - 1)),
          Math.round(Math.floor(pixel / side ** 2) * quantum / (side - 1)), quantum,
        ]);
      }
      const applied = ["xc:#4080c0", `hald:${level}`, "-hald-clut", "/out.png"];
      expect((await runMagickCli(applied, mode === "map" ? files : { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
      expect(Array.from(decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png")).data)).toEqual([64, 128, 192, 255]);
    });
  }
}
