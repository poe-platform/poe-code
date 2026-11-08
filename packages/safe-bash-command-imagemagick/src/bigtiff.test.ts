import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./bigtiff-fixtures.json" with { type: "json" };

// Native ImageMagick: 23x19 red-blue gradient, 8-bit RGB, uncompressed TIFF64.
// Expected RGBA is independently decoded by native ImageMagick.
for (const endian of ["little", "big"] as const) {
  for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it(`reads native BigTIFF pixels (${endian}, ${mode})`, async () => {
      const input = Uint8Array.from(Buffer.from(fixtures[endian], "base64"));
      expect(input[0]).toBe(endian === "little" ? 73 : 77);
      const files = new Map([["in.tif", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.tif", input);
      const args = ["in.tif", "out.png"];
      let result;
      if (mode === "command") {
        let stderr = "";
        result = await createMagickCommand().execute({
          command: "magick", args, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(stderr).toBe("");
      } else result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const image = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
      expect([image.width, image.height]).toEqual([23, 19]);
      expect(image.data).toEqual(Uint8Array.from(Buffer.from(fixtures.rgba, "base64")));
    });
  }
}

for (const mode of ["sync", "retained"] as const) {
  for (const malformed of ["offset size", "reserved", "unsafe offset", "truncated directory", "unsafe count", "unsafe strip offset"] as const) {
    it(`rejects BigTIFF ${malformed} (${mode})`, async () => {
      const input = Uint8Array.from(Buffer.from(fixtures.little, "base64"));
      const view = new DataView(input.buffer);
      const directory = Number(view.getBigUint64(8, true));
      if (malformed === "offset size") view.setUint16(4, 4, true);
      if (malformed === "reserved") view.setUint16(6, 1, true);
      if (malformed === "unsafe offset") view.setBigUint64(8, 2n ** 53n, true);
      if (malformed === "truncated directory") view.setBigUint64(8, BigInt(input.length - 1), true);
      if (malformed === "unsafe count") view.setBigUint64(directory, 2n ** 53n, true);
      if (malformed === "unsafe strip offset") {
        const count = Number(view.getBigUint64(directory, true));
        for (let i = 0; i < count; i++) {
          const entry = directory + 8 + i * 20;
          if (view.getUint16(entry, true) === 273) view.setBigUint64(entry + 12, 2n ** 53n, true);
        }
      }
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.tif", input);
      const result = mode === "sync" ? runMagickCliSync(["in.tif", "out.png"], new Map([["in.tif", input]])) : await runMagickCli(["in.tif", "out.png"], { filesystem, cwd: "/" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/TIFF|bounds/);
    });
  }
}
