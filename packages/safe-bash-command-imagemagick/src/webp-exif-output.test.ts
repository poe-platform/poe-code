import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent PNG fixture: big-endian EXIF with Orientation, Artist and ImageDescription.
// TIFF converted by ImageMagick 7.1.2-35 carries orientation but no EXIF profile.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAARGVYSWZNTQAqAAAACAADAQ4AAgAAAAsAAAAyARIAAwAAAAEABgAAATsAAgAAAAcAAAA9AAAAAHNpeCBwaXhlbHMAUGFyaXR5AFul1agAAAAYSURBVHicY/jPwMAAwf/fMcwULFcJbgEARKsHBzwYqGEAAAAASUVORK5CYII=", "base64");
const tiff = Buffer.from("SUkqABoAAAD/AAAA/wAAAP//7gCZEXckU4QPAAABAwABAAAAAwAAAAEBAwABAAAAAgAAAAIBAwADAAAA1AAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAABgAAABUBAwABAAAAAwAAABYBAwABAAAAAgAAABcBBAABAAAAEgAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD4BBQACAAAACgEAAD8BBQAGAAAA2gAAAAAAAAAIAAgACACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA", "base64");
const sourceExif = new Uint8Array(png.subarray(41, 109));

for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const lossless of [false, true]) {
    for (const animated of [false, true]) {
      it(`preserves only source WebP EXIF (${mode}, lossless=${lossless}, animated=${animated})`, async () => {
        for (const { input, options, orientation } of [
          { input: png, options: [], orientation: 6 },
          { input: png, options: ["-auto-orient"], orientation: 1 },
          { input: png, options: ["+profile", "exif"], orientation: undefined },
          { input: png, options: ["-strip"], orientation: undefined },
          { input: tiff, options: [], orientation: undefined },
          { input: tiff, options: ["-auto-orient"], orientation: undefined }
        ]) {
          const files = new Map<string, Uint8Array>([["/input", input]]);
          const filesystem = new MemoryFileSystem();
          await filesystem.writeFile("/input", input);
          const args = ["/input", ...(animated ? ["/input"] : []), ...options,
            "-define", `webp:lossless=${lossless}`, "-write", "/copy.webp", "/output.webp"];
          const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
          expect(result).toMatchObject({ exitCode: 0, stderr: "" });
          for (const path of ["/copy.webp", "/output.webp"]) {
            const output = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
            expect(view.getUint32(4, true)).toBe(output.length - 8);
            const chunks = new Map<string, Uint8Array>();
            for (let at = 12; at < output.length;) {
              const size = view.getUint32(at + 4, true);
              chunks.set(new TextDecoder().decode(output.subarray(at, at + 4)), output.slice(at + 8, at + 8 + size));
              at += 8 + size + (size & 1);
            }
            if (orientation === undefined) {
              expect(chunks.has("EXIF")).toBe(false);
              expect((chunks.get("VP8X")?.[0] ?? 0) & 8).toBe(0);
            } else {
              const expected = sourceExif.slice();
              new DataView(expected.buffer).setUint16(30, orientation);
              expect(chunks.get("EXIF")).toEqual(expected);
              expect(chunks.get("VP8X")![0]! & 8).toBe(8);
              const extended = chunks.get("VP8X")!;
              expect([extended[4]! + 1, extended[7]! + 1]).toEqual(orientation === 1 ? [2, 3] : [3, 2]);
            }
          }
        }
      });
    }
  }
}

it("preserves the source PNG EXIF as a control", async () => {
  const files = new Map([["/input.png", png]]);
  expect(await runConvertCli(["/input.png", "/output.png"], files)).toMatchObject({ exitCode: 0 });
  const output = files.get("/output.png")!;
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let exif: Uint8Array | undefined;
  for (let at = 8; at < output.length;) {
    const length = view.getUint32(at);
    if (new TextDecoder().decode(output.subarray(at + 4, at + 8)) === "eXIf") exif = output.slice(at + 8, at + 8 + length);
    at += length + 12;
  }
  expect(exif).toEqual(sourceExif);
});
