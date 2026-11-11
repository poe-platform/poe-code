import { expect, it } from "vitest";
import { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 rounds cm -> inch to hundredths before resampling.
const cases = [
  { name: "unchanged", source: "PixelsPerCentimeter", density: "31.234x55.678", options: [], x: 31.234, y: 55.678, unit: "cm", width: 8 },
  { name: "same units", source: "PixelsPerCentimeter", density: "31.234x55.678", options: ["-units", "PixelsPerCentimeter"], x: 31.234, y: 55.678, unit: "cm", width: 8 },
  { name: "convert", source: "PixelsPerCentimeter", density: "31.234x55.678", options: ["-units", "PixelsPerInch"], x: 79.33, y: 141.42, unit: "inch", width: 8 },
  { name: "round up", source: "PixelsPerCentimeter", density: "31.236x55.681", options: ["-units", "PixelsPerInch"], x: 79.34, y: 141.43, unit: "inch", width: 8 },
  { name: "resample", source: "PixelsPerCentimeter", density: "31.234x55.678", options: ["-units", "PixelsPerInch", "-resample", "84.29x141.42"], x: 84.29, y: 141.42, unit: "inch", width: 9 },
  { name: "reverse conversion", source: "PixelsPerInch", density: "31.234x55.678", options: ["-units", "PixelsPerCentimeter"], x: 31.234 / 2.54, y: 55.678 / 2.54, unit: "cm", width: 8 },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(cases)(`preserves native density precision: $name (${mode})`, async fixture => {
    const input = Buffer.concat([
      Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass matte=False\ncolumns=8 rows=5 depth=8\ncolorspace=sRGB\ncompression=None\nresolution=${fixture.density}\nunits=${fixture.source}\n\f\n:\x1a`),
      Buffer.from(Array.from({ length: 120 }, (_, i) => (13 * i + 9) % 256)),
    ]);
    const files = new Map<string, Uint8Array>([["/input.miff", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.miff", input);
    const args = ["/input.miff", ...fixture.options, "-write", "/out.miff", "-format", "%x|%y|%U", "info:/density"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const density = mode === "sync" || mode === "buffered" ? files.get("/density")! : await fs.readFile("/density");
    const [x, y, unit] = new TextDecoder().decode(density).split("|");
    expect(Number(x)).toBeCloseTo(fixture.x, 8);
    expect(Number(y)).toBeCloseTo(fixture.y, 8);
    expect(unit).toBe(fixture.unit === "cm" ? "PixelsPerCentimeter" : "PixelsPerInch");
    const output = mode === "sync" || mode === "buffered" ? files.get("/out.miff")! : await fs.readFile("/out.miff");
    const metadata = readImageMetadata(output);
    expect(metadata).toMatchObject({ width: fixture.width, height: 5, resolution: { unit: fixture.unit } });
    // MIFF itself stores six significant digits; the resample assertion checks the working precision.
    expect(metadata.resolution!.x).toBeCloseTo(fixture.x, 3);
    expect(metadata.resolution!.y).toBeCloseTo(fixture.y, 3);
  });
}
