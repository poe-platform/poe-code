import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick/libwebp: two 8x8 lossless frames, red then blue, 70/190 ms, loop 3.
const input = new Uint8Array(Buffer.from("UklGRoQAAABXRUJQVlA4WAoAAAACAAAABwAABwAAQU5JTQYAAAD/////AwBBTk1GKAAAAAAAAAAAAAcAAAcAAEYAAAJWUDhMDwAAAC8HwAEABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAcAAAcAAL4AAABWUDhMDwAAAC8HwAEABxDR//4HIqL/AQA=", "base64"));

for (const mode of ["buffered", "retained"] as const) {
  it(`reads lossless WebP frame inventory, timing and pixels (${mode})`, async () => {
    const files = new Map([["/two.webp", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/two.webp", input);
    const backend = mode === "buffered" ? files : { filesystem, cwd: "/" };
    const info = await runConvertCli(["/two.webp", "-format", "%s:%wx%h:%T;", "info:"], backend);
    expect(info).toMatchObject({ exitCode: 0, stdout: "0:8x8:7;1:8x8:19;" });
    expect(await runConvertCli(["/two.webp", "/out.png"], backend)).toMatchObject({ exitCode: 0 });
    for (const [index, color] of [[0, [255, 0, 0, 255]], [1, [0, 0, 255, 255]]] as const) {
      const name = `/out-${index}.png`;
      const bytes = mode === "buffered" ? files.get(name)! : await filesystem.readFile(name);
      expect(Array.from(decodeImage(bytes).data)).toEqual(Array.from({ length: 64 }, () => [...color]).flat());
    }
    expect(await runConvertCli(["/two.webp[1]", "/selected.png"], backend)).toMatchObject({ exitCode: 0 });
    const selected = mode === "buffered" ? files.get("/selected.png")! : await filesystem.readFile("/selected.png");
    expect(Array.from(decodeImage(selected).data.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expect(await runConvertCli(["/two.webp", "/out.gif"], backend)).toMatchObject({ exitCode: 0 });
    const gif = mode === "buffered" ? files.get("/out.gif")! : await filesystem.readFile("/out.gif");
    expect(readImageMetadata(gif)).toMatchObject({ pages: 2, delay: [70, 190], loop: 3 });
  });
}

it("exposes WebP animation metadata and rejects invalid frame selection and bounds", () => {
  expect(readImageMetadata(input)).toMatchObject({ pages: 2, delay: [70, 190], loop: 3 });
  expect(Array.from(decodeImage(input, { page: 1 }).data.slice(0, 4))).toEqual([0, 0, 255, 255]);
  expect(() => decodeImage(input, { page: 2 })).toThrow("out of range");
  const outside = input.slice();
  outside[52] = 8; // First ANMF's x offset is stored in units of two pixels.
  expect(() => decodeImage(outside)).toThrow("exceeds canvas");
  const mismatch = input.slice();
  mismatch[58] = 6; // ANMF claims width 7, while the nested VP8L image is 8 wide.
  expect(() => decodeImage(mismatch)).toThrow("frame dimensions");
});
