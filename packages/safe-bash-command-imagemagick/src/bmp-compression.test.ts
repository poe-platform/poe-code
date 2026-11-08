import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAgMAAABmjvwnAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAACklEQVR4nGOQAAAAGgAZLYj0NgAAAABJRU5ErkJggg==", "base64");
for (const mode of ["sync", "buffered", "retained"] as const) for (const version of ["BMP", "BMP2", "BMP3"]) {
  it(`writes explicit BMP compression and resets it (${mode}, ${version})`, async () => {
    const files = new Map<string, Uint8Array>([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-compress", "RLE", "-write", `${version}:/rle.bmp`, "-compress", "None", "-write", `${version}:/none.bmp`, "-compress", "RLE", "+compress", `${version}:/reset.bmp`];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    for (const name of ["rle", "none", "reset"]) {
      const bytes = mode === "retained" ? await filesystem.readFile(`/${name}.bmp`) : files.get(`/${name}.bmp`)!;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), rle = name === "rle" && version !== "BMP2";
      expect(view.getUint16(version === "BMP2" ? 24 : 28, true)).toBe(rle ? 8 : 4);
      if (version !== "BMP2") expect(view.getUint32(30, true)).toBe(rle ? 1 : 0);
      expect(view.getUint32(2, true)).toBe(bytes.length);
      if (rle) expect(view.getUint32(34, true)).toBe(bytes.length - view.getUint32(10, true));
      expect(Array.from(decodeImage(bytes).data)).toEqual([255,0,0,255,0,255,0,255,0,0,255,255]);
    }
  });
}

for (const pattern of ["runs", "alternating"] as const) it(`encodes multiple rows across RLE run and chunk boundaries (${pattern})`, async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.png", input);
  const args = ["/in.png", "-scale", "3000x2!", "-compress", "RLE", "/out.bmp"];
  if (pattern === "alternating") args.splice(1, 2, "-duplicate", "999", "+append", "-duplicate", "1", "-append");
  const files = new Map<string, Uint8Array>([["/in.png", input]]);
  expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0, stderr: "" });
  expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
  const bytes = await filesystem.readFile("/out.bmp");
  expect(bytes).toEqual(files.get("/out.bmp"));
  const decoded = decodeImage(bytes);
  expect([decoded.width, decoded.height]).toEqual([3000, 2]);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3000; x++) {
    const color = pattern === "runs" ? Math.floor(x / 1000) : x % 3;
    expect(Array.from(decoded.data.subarray((y * 3000 + x) * 4, (y * 3000 + x + 1) * 4))).toEqual([color === 0 ? 255 : 0, color === 1 ? 255 : 0, color === 2 ? 255 : 0, 255]);
  }
});
