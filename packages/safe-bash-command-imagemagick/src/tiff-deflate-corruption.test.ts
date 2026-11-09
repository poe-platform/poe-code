import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Two independently specified RGB rows in a classic little-endian TIFF.
function fixture(compression: number) {
  const rows = [deflateSync(Uint8Array.of(16, 32, 48, 64, 80, 96)), deflateSync(Uint8Array.of(112, 128, 144, 160, 176, 192))];
  const tags = [[256, 4, 1, 2], [257, 4, 1, 2], [258, 3, 1, 8],
    [259, 3, 1, compression], [262, 3, 1, 2], [273, 4, 2, 122],
    [277, 3, 1, 3], [278, 4, 1, 1], [279, 4, 2, 130]];
  const bytes = new Uint8Array(138 + rows[0]!.length + rows[1]!.length), view = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag!, true); view.setUint16(at + 2, type!, true);
    view.setUint32(at + 4, count!, true); view.setUint32(at + 8, value!, true);
  });
  [138, 138 + rows[0]!.length, rows[0]!.length, rows[1]!.length].forEach((value, i) => view.setUint32(122 + i * 4, value, true));
  bytes.set(rows[0]!, 138); bytes.set(rows[1]!, 138 + rows[0]!.length);
  return bytes;
}

for (const compression of [8, 32946])
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const damage of ["none", "header", "checksum"] as const) {
    it(`handles TIFF Deflate ${compression} ${damage} without corrupting the destination (${mode})`, async () => {
      const input = fixture(compression);
      const second = new DataView(input.buffer).getUint32(126, true);
      if (damage === "header") input.set([81, 81], second);
      if (damage === "checksum") input[input.length - 1]! ^= 1;
      const original = new TextEncoder().encode("keep");
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
      expect(result.exitCode).toBe(damage === "none" ? 0 : 1);
      const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
      if (damage !== "none") expect(output).toEqual(original);
      else expect(decodeImage(output).data).toEqual(Uint8Array.of(16, 32, 48, 255, 64, 80, 96, 255, 112, 128, 144, 255, 160, 176, 192, 255));
    });
  }
}
