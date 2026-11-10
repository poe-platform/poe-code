import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
for (const hald of [false, true])
for (const highDepth of [false, true])
it.each([
  ["nearest", [0, 0, 255, 255], [85, 170, 170, 255]],
  ["nearest-neighbor", [0, 0, 255, 255], [85, 170, 170, 255]],
  ["integer", [0, 0, 255, 255], [0, 128, 192, 255]],
  ["blend", [128, 0, 128, 255], [85, 128, 192, 255]],
  ["average", [128, 0, 128, 255], [43, 138, 208, 255]],
  ["bilinear", [127, 0, 128, 255], [64, 128, 192, 255]],
] as const)(`samples native lookup pixels, retained=${retained}, hald=${hald}, highDepth=${highDepth}, %s`, async (method, clutExpected, haldExpected) => {
  // Native ImageMagick 7.1.2: xc:#808080 + red/blue CLUT, or xc:#4080c0 + hald:2.
  const lut = hald ? Uint8Array.from({ length: 64 * 3 }, (_, i) => Math.floor(Math.floor(i / 3) / 4 ** (i % 3)) % 4 * 85) : Uint8Array.of(255, 0, 0, 0, 0, 255);
  const files = new Map([
    ["/base.png", await sharp(Uint8Array.from(hald ? [64, 128, 192] : [128, 128, 128]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer()],
    ["/lut.png", await sharp(lut, { raw: { width: hald ? 8 : 2, height: hald ? 8 : 1, channels: 3 } }).png().toBuffer()],
  ]);
  if (highDepth) for (const [path, bytes] of files) {
    const image = decodeImage(bytes);
    files.set(path, Buffer.from(encodeImage({ ...image, depth: "ushort", data16: Uint16Array.from(image.data, value => value * 257) }, { format: "png" }).data));
  }
  const fs = new MemoryFileSystem();
  for (const [path, data] of files) await fs.writeFile(path, data);
  expect(await runConvertCli(["/base.png", "/lut.png", "-interpolate", method, hald ? "-hald-clut" : "-clut", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
  if (highDepth) {
    // Compare the stored 16-bit samples; the decoder's byte preview truncates them.
    const expected = method === "blend" && !hald ? [32768, 0, 32768, 65535] : method === "average" ? hald ? [10923, 35499, 53439, 65535] : [32768, 0, 32768, 65535] : (hald ? haldExpected : clutExpected).map(value => value * 257);
    expect(output.data16).toEqual(Uint16Array.from(expected));
  } else expect(output.data).toEqual(Uint8Array.from(hald ? haldExpected : clutExpected));
});

for (const retained of [false, true]) {
  it(`rejects missing and unknown interpolation, retained=${retained}`, async () => {
    for (const method of [[], ["bogus"]]) {
      const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
      const result = await runConvertCli(["xc:red", "-interpolate", ...method, "/out.png"], input);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized interpolate method");
    }
  });
  it(`resets interpolation to bilinear, retained=${retained}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["xc:#808080", "(", "xc:red", "xc:blue", "+append", ")", "-interpolate", "nearest", "+interpolate", "-clut", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toEqual(Uint8Array.of(127, 0, 128, 255));
  });
}
