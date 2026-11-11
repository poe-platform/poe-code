import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI fixtures, including byte-padded rows.
const fixtures = [
  { width: 11, height: 12, raster: Buffer.from("a52058e0f040".repeat(4), "hex"), header: "00000b0c", grayHash: "55c314319c292a137abb00a59aeb1dfcc3a3367ac66213f2cc3635eec46ed76b" },
  { width: 259, height: 12, raster: Buffer.from(Array.from({ length: 396 }, (_, i) => i % 33 < 32 ? (i % 33 * 13 + Math.floor(i / 33) * 29 + 5) % 256 : 160)), header: "000082030c", grayHash: "3073be48303ddd682a2750abd7b5f000034daa8fdab8b2cb20c7b1cc5c2e81b8" },
];

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const fixture of fixtures) {
    it.each(["/out.wbmp", "WBMP:/out.bin", "wbmp:-"])(`writes WBMP ${fixture.width}x${fixture.height} via %s (${mode})`, async output => {
      const { width, height, raster, header, grayHash } = fixture;
      const input = Buffer.concat([Buffer.from(`P4\n${width} ${height}\n`), raster]);
      const files = new Map<string, Uint8Array>([["/in.pbm", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.pbm", input);
      const args = ["/in.pbm", "-write", output, "null:"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode, result.stderr).toBe(0);
      const path = output === "/out.wbmp" ? output : "/out.bin";
      const bytes = output === "wbmp:-" ? result.stdoutBytes! : mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
      const headerBytes = Buffer.from(header, "hex"), stride = Math.ceil(width / 8);
      expect(Buffer.from(bytes.subarray(0, headerBytes.length))).toEqual(headerBytes);
      expect(bytes.length).toBe(headerBytes.length + stride * height);
      if (width === 11) expect(Buffer.from(bytes).toString("hex")).toBe("00000b0c" + "5ac0a7000fa0".repeat(4));
      // Decode WBMP's white=1, MSB-first raster independently of image-ast.
      const gray = Buffer.from(Array.from({ length: width * height }, (_, i) =>
        (bytes[headerBytes.length + Math.floor(i / width) * stride + Math.floor(i % width / 8)]! >> (7 - i % width % 8)) & 1 ? 255 : 0));
      expect(createHash("sha256").update(gray).digest("hex")).toBe(grayHash);
      for (let y = 0; y < height; y++) expect(bytes[headerBytes.length + (y + 1) * stride - 1]! & 31).toBe(0);
    });
  }
  it.each([
    ["P1\n3 1\n0 1 0\n", "00000301a0"],
    ["P2\n5 1\n65535\n1000 2000 3000 4000 5000\n", "0000050118"],
  ])(`normalizes monochrome final output (${mode}, %s)`, async (source, expected) => {
    const input = Buffer.from(source), files = new Map([["/in.pbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pbm", input);
    const args = ["/in.pbm", "/out.wbmp"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/out.wbmp") : files.get("/out.wbmp")!)).toEqual(Buffer.from(expected, "hex"));
  });
}
