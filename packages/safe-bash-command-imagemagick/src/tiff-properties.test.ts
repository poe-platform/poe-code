import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Uncompressed 4x3 RGB TIFFs with inline Artist and offset Model/Copyright ASCII tags.
const fixtures = [
  "SUkqACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAIBAwADAAAAzgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAA4BAgAFAAAA1AAAABABAgAIAAAA2QAAABEBBAABAAAACAAAABUBAwABAAAAAwAAABYBBAABAAAAAwAAABcBBAABAAAAJAAAADsBAgAEAAAAUGF0AJiCAgAMAAAA4QAAAAAAAAAIAAgACABMZWFmAE1vZGVsNDIAQ29weXJpZ2h0IEEA",
  "TU0AKgAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQEAAAQAAAABAAAABAEBAAQAAAABAAAAAwECAAMAAAADAAAAzgEDAAMAAAABAAEAAAEGAAMAAAABAAIAAAEOAAIAAAAFAAAA1AEQAAIAAAAIAAAA2QERAAQAAAABAAAACAEVAAMAAAABAAMAAAEWAAQAAAABAAAAAwEXAAQAAAABAAAAJAE7AAIAAAAEUGF0AIKYAAIAAAAMAAAA4QAAAAAACAAIAAhMZWFmAE1vZGVsNDIAQ29weXJpZ2h0IEEA"
];
const format = "%[tiff:artist]|%[tiff:model]|%[tiff:rows-per-strip]|%[tiff:photometric]|%[tiff:copyright]|%c";
const expected = "Pat|Model42|3|RGB|Copyright A|Leaf";

for (const [index, fixture] of fixtures.entries()) {
  const bytes = Uint8Array.from(Buffer.from(fixture, "base64"));
  it(`matches native TIFF tag formatting (${index})`, () => {
    const native = spawnSync("magick", ["identify", "-format", format, "-"], { input: bytes, encoding: "utf8" });
    expect(native.status, native.stderr).toBe(0);
    expect(native.stdout).toBe(expected);
  });
  for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`formats TIFF tags (${index}, ${mode})`, async () => {
      const files = new Map([["/tags.tif", bytes]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/tags.tif", bytes);
      const args = ["identify", "-format", format, "/tags.tif"];
      const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: expected });
    });
  }
}
