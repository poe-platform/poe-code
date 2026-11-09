import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Two independently specified RGB rows in a classic little-endian TIFF.
function fixture(payload: Uint8Array) {
  const tags = [[256, 4, 1, 2], [257, 4, 1, 2], [258, 3, 1, 8],
    [259, 3, 1, 32773], [262, 3, 1, 2], [273, 4, 2, 122],
    [277, 3, 1, 3], [278, 4, 1, 1], [279, 4, 2, 130]];
  const bytes = new Uint8Array(138 + payload.length * 2), view = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag!, true); view.setUint16(at + 2, type!, true);
    view.setUint32(at + 4, count!, true); view.setUint32(at + 8, value!, true);
  });
  [138, 138 + payload.length, payload.length, payload.length].forEach((value, i) => view.setUint32(122 + i * 4, value, true));
  bytes.set(payload, 138); bytes.set(payload, 138 + payload.length);
  return bytes;
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const [name, payload, valid] of [
    ["raw bytes mislabeled PackBits", Uint8Array.of(16, 32, 48, 64, 80, 96), false],
    ["truncated literal", Uint8Array.of(5, 16, 32), false],
    ["literal truncated beyond raster", Uint8Array.of(6, 16, 32, 48, 64, 80, 96), false],
    ["missing repeat byte", Uint8Array.of(251), false],
    ["short complete run", Uint8Array.of(255, 16), false],
    ["only no-op", Uint8Array.of(128), false],
    ["valid literals", Uint8Array.of(5, 16, 32, 48, 64, 80, 96), true],
    ["valid repeat", Uint8Array.of(251, 16), true],
    ["valid no-op", Uint8Array.of(128, 5, 16, 32, 48, 64, 80, 96), true],
  ] as const) {
    it(`handles TIFF PackBits ${name} without publishing a partial raster (${mode})`, async () => {
      const input = fixture(payload), original = new TextEncoder().encode("keep");
      const files = new Map([["in.tif", input], ["out.png", original]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.tif", input); await filesystem.writeFile("/out.png", original);
      const args = ["in.tif", "out.png"];
      let result;
      if (mode === "command") result = await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
      });
      else result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(valid ? 0 : 1);
      const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
      if (!valid) expect(output).toEqual(original);
      else {
        const row = name === "valid repeat" ? [16, 16, 16, 255, 16, 16, 16, 255] : [16, 32, 48, 255, 64, 80, 96, 255];
        expect(decodeImage(output).data).toEqual(new Uint8Array([...row, ...row]));
      }
    });
  }
}
