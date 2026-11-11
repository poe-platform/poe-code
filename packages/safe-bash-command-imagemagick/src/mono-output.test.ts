import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI fixtures, including byte-padded rows.
const fixtures = [
  { width: 11, height: 12, raster: Buffer.from("a52058e0f040".repeat(4), "hex"), grayHash: "55c314319c292a137abb00a59aeb1dfcc3a3367ac66213f2cc3635eec46ed76b" },
  { width: 259, height: 12, raster: Buffer.from(Array.from({ length: 396 }, (_, i) => i % 33 < 32 ? (i % 33 * 13 + Math.floor(i / 33) * 29 + 5) % 256 : 160)), grayHash: "3073be48303ddd682a2750abd7b5f000034daa8fdab8b2cb20c7b1cc5c2e81b8" },
];

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const fixture of fixtures) for (const write of [false, true]) {
    it.each(["/out.mono", "MONO:/out.bin", "mono:-"])(`writes MONO ${fixture.width}x${fixture.height} via %s (${mode}, write=${write})`, async output => {
      const { width, height, raster, grayHash } = fixture;
      const input = Buffer.concat([Buffer.from(`P4\n${width} ${height}\n`), raster]);
      const files = new Map<string, Uint8Array>([["/in.pbm", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.pbm", input);
      const args = ["/in.pbm", ...(write ? ["-write", output, "null:"] : [output])];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode, result.stderr).toBe(0);
      const path = output === "/out.mono" ? output : "/out.bin";
      const bytes = output === "mono:-" ? result.stdoutBytes! : mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
      const stride = Math.ceil(width / 8);
      expect(bytes.length).toBe(stride * height);
      if (width === 11) expect(Buffer.from(bytes).toString("hex")).toBe("a5041a070f02".repeat(4));
      if (width === 259) expect(Buffer.from(bytes.subarray(0, 8)).toString("hex")).toBe("a048f8349c62ca06");
      // Decode MONO's black=1, LSB-first raster independently of image-ast.
      const gray = Buffer.from(Array.from({ length: width * height }, (_, i) =>
        (bytes[Math.floor(i / width) * stride + Math.floor(i % width / 8)]! >> (i % width % 8)) & 1 ? 0 : 255));
      expect(createHash("sha256").update(gray).digest("hex")).toBe(grayHash);
      for (let y = 0; y < height; y++) expect(bytes[(y + 1) * stride - 1]! & 248).toBe(0);
    });
  }
  it(`selects MONO for the final destination (${mode})`, async () => {
    const input = Buffer.from("P1\n3 1\n0 1 0\n"), files = new Map([["/in.pbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pbm", input);
    const args = ["/in.pbm", "/out.mono"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/out.mono") : files.get("/out.mono")!)).toEqual(Buffer.from("02", "hex"));
  });
  it.each([ ["LSB", "15"], ["MSB", "0a"] ])(`writes bilevel color pixels with %s polarity (${mode})`, async (endian, expected) => {
    const input = Buffer.from("P3\n5 1\n255\n255 0 0 0 255 0 0 0 255 255 255 255 0 0 0\n");
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-endian", endian!, "-depth", "16", "mono:-"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
  });
}
