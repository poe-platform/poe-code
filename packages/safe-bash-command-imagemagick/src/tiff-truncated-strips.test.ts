import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Two independently specified RGB rows in a classic little-endian TIFF.
function fixture() {
  const tags = [[256, 4, 1, 2], [257, 4, 1, 2], [258, 3, 1, 8],
    [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 2, 122],
    [277, 3, 1, 3], [278, 4, 1, 1], [279, 4, 2, 130]];
  const bytes = new Uint8Array(150), view = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag!, true); view.setUint16(at + 2, type!, true);
    view.setUint32(at + 4, count!, true); view.setUint32(at + 8, value!, true);
  });
  [138, 144, 6, 6].forEach((value, i) => view.setUint32(122 + i * 4, value, true));
  bytes.set([16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192], 138);
  return bytes;
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const damage of ["none", "partial strip", "missing strip", "offset beyond EOF", "short byte count"] as const) {
    it(`handles TIFF ${damage} without corrupting the destination (${mode})`, async () => {
      let input = fixture();
      if (damage === "partial strip") input = input.slice(0, -3);
      if (damage === "missing strip") input = input.slice(0, -6);
      if (damage === "offset beyond EOF") new DataView(input.buffer).setUint32(126, input.length + 50, true);
      if (damage === "short byte count") new DataView(input.buffer).setUint32(134, 1, true);
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
