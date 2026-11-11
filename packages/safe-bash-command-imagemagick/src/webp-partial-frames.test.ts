import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCliSync } from "./index.js";

// libwebp: an 8x6 red canvas, then a 2x2 update at +6+4 with blue diagonal pixels.
const partial = new Uint8Array(Buffer.from("UklGRooAAABXRUJQVlA4WAoAAAACAAAABwAABQAAQU5JTQYAAAD/////AwBBTk1GLAAAAAAAAAAAAAcAAAUAAEYAAAJWUDhMFAAAAC8HQAEABxD9j/4HAILwv20iov8hQU5NRioAAAADAAACAAABAAABAAC+AAAAVlA4TBIAAAAvAUAAAA8Q87//8x8OViCi/xE=", "base64"));

// Display ANMF rectangles according to WebP's blend/disposal flags, independent of encoding layout.
function displayedFrames(bytes: Uint8Array): Uint8Array[] {
  const { width, height } = readImageMetadata(bytes);
  const canvas = new Uint8Array(width * height * 4), frames: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (new TextDecoder().decode(bytes.subarray(at, at + 4)) === "ANMF") {
      const frame = decodeImage(bytes, { page: frames.length });
      const left = frame.virtualCanvas?.x ?? 0, top = frame.virtualCanvas?.y ?? 0;
      const flags = bytes[at + 23]!;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const source = (y * frame.width + x) * 4, target = ((top + y) * width + left + x) * 4;
        const alpha = frame.data[source + 3]! / 255;
        const retainedAlpha = flags & 2 ? 0 : canvas[target + 3]! / 255 * (1 - alpha);
        const total = alpha + retainedAlpha;
        for (let channel = 0; channel < 3; channel++) canvas[target + channel] = total === 0 ? 0
          : Math.round((frame.data[source + channel]! * alpha + canvas[target + channel]! * retainedAlpha) / total);
        canvas[target + 3] = Math.round(total * 255);
      }
      frames.push(canvas.slice());
      if (flags & 1) for (let y = 0; y < frame.height; y++) canvas.fill(0, ((top + y) * width + left) * 4, ((top + y) * width + left + frame.width) * 4);
    }
    at += 8 + size + (size & 1);
  }
  return frames;
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const write of [false, true]) {
    for (const coalesce of [false, true]) {
      it.each([
        { name: "positioned WebP update", args: ["/in.webp"], blue: (x: number, y: number) => x === 6 && y === 4 || x === 7 && y === 5, delay: [70, 190] },
        { name: "smaller generated frame", args: ["-size", "8x6", "-delay", "7", "xc:red", "-size", "4x4", "-delay", "19", "xc:blue", "-loop", "3"], blue: (x: number, y: number) => x < 4 && y < 4, delay: [70, 190] }
      ])(`preserves the displayed $name (${mode}, write=${write}, coalesce=${coalesce})`, async ({ args, blue, delay }) => {
        const files = new Map([["/in.webp", partial]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.webp", partial);
        const argv = [...args, ...(coalesce ? ["-coalesce"] : []), "-define", "webp:lossless=true", ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
          : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const bytes = mode === "retained" ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
        expect(readImageMetadata(bytes)).toMatchObject({ width: 8, height: 6, pages: 2, delay, loop: 3 });
        const frames = displayedFrames(bytes);
        for (const page of [0, 1]) {
          expect(frames[page]).toEqual(Uint8Array.from(Array.from({ length: 48 }, (_, pixel) =>
            page === 1 && blue(pixel % 8, Math.floor(pixel / 8)) ? [0, 0, 255, 255] : [255, 0, 0, 255]).flat()));
        }
      });
    }
  }
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const write of [false, true]) {
    it.each(["Background", "Previous"])(`applies %s disposal before the next WebP update (${mode}, write=${write})`, async disposal => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      const args = ["-size", "8x6", "xc:red", "(", "-size", "2x2", "-page", "8x6+6+4", "-dispose", disposal, "xc:blue", ")",
        "(", "-size", "2x2", "-page", "8x6+0+0", "xc:lime", ")", "-define", "webp:lossless=true",
        ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])];
      const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const bytes = mode === "retained" ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
      const frames = displayedFrames(bytes);
      expect(frames).toHaveLength(3);
      for (const page of [0, 1, 2]) {
        expect(frames[page]).toEqual(Uint8Array.from(Array.from({ length: 48 }, (_, pixel) => {
          const x = pixel % 8, y = Math.floor(pixel / 8);
          if (page === 2 && x < 2 && y < 2) return [0, 255, 0, 255];
          if (x >= 6 && y >= 4) {
            if (page === 1) return [0, 0, 255, 255];
            if (page === 2 && disposal === "Background") return [0, 0, 0, 0];
          }
          return [255, 0, 0, 255];
        }).flat()));
      }
    });
  }
}
