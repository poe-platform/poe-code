import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained"] as const) {
  for (const write of [false, true]) {
    it(`writes every WebP frame with timing and loop (${mode}, write=${write})`, async () => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      const backend = mode === "buffered" ? files : { filesystem, cwd: "/" };
      const result = await runConvertCli([
        "-quality", "100", "-size", "8x8", "-delay", "7", "xc:red", "-delay", "19", "xc:blue", "-loop", "3",
        ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])
      ], backend);
      expect(result).toMatchObject({ exitCode: 0 });
      const bytes = mode === "buffered" ? files.get("/out.webp")! : await filesystem.readFile("/out.webp");
      expect(readImageMetadata(bytes)).toMatchObject({ pages: 2, delay: [70, 190], loop: 3 });
      const frames: Uint8Array[] = [];
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 12; offset < bytes.length;) {
        const length = view.getUint32(offset + 4, true);
        if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === "ANMF") {
          const frame = new Uint8Array(12 + length - 16);
          frame.set([82, 73, 70, 70]);
          new DataView(frame.buffer).setUint32(4, frame.length - 8, true);
          frame.set([87, 69, 66, 80], 8);
          frame.set(bytes.subarray(offset + 24, offset + 8 + length), 12);
          frames.push(decodeImage(frame).data);
        }
        offset += 8 + length + (length & 1);
      }
      expect(frames).toEqual([
        Uint8Array.from(Array.from({ length: 64 }, () => [255, 0, 0, 255]).flat()),
        Uint8Array.from(Array.from({ length: 64 }, () => [0, 0, 255, 255]).flat())
      ]);
    });
  }
}
