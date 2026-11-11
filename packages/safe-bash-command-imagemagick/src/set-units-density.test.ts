import { expect, it } from "vitest";
import { encodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: -set units relabels stored axes; -resample uses those numbers.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
  for (const [format, unit, x, y, assigned] of [
    ["miff", "cm", 31.234, 55.678, "PixelsPerInch"],
    ["miff", "inch", 144, 90, "PixelsPerCentimeter"],
    ["png", "meter", 3123, 5567, "PixelsPerInch"],
  ] as const) {
    for (const relabel of [false, true]) {
      for (const resample of [false, true]) {
        it(`preserves stored density axes (${mode}, ${format}, ${unit}, set=${relabel}, resample=${resample})`, async () => {
          const input = encodeImage({ width: 8, height: 5,
            data: Uint8Array.from({ length: 160 }, (_, i) => i % 4 === 3 ? 255 : (13 * (i - Math.floor(i / 4)) + 9) % 256),
            format, space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
            resolution: { x, y, unit } }, { format }).data;
          const sourceX = unit === "meter" ? x / 100 : x, sourceY = unit === "meter" ? y / 100 : y;
          const units = relabel ? assigned : unit === "inch" ? "PixelsPerInch" : "PixelsPerCentimeter";
          const expectedUnit = units === "PixelsPerInch" ? "inch" : "cm";
          const files = new Map([[`/in.${format}`, input]]), fs = new MemoryFileSystem();
          await fs.writeFile(`/in.${format}`, input);
          const args = [`/in.${format}`, ...(relabel ? ["-set", "units", assigned] : []),
            ...(resample ? ["-filter", "point", "-resample", `${sourceX * 2}x${sourceY * 2}`] : []),
            "-write", "/out.miff", "-format", "%x|%y|%U", "info:/density"];
          let stderr = "";
          const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
            args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
          if ("stderr" in result) stderr = result.stderr;
          expect(result.exitCode, stderr).toBe(0);
          expect(stderr).toBe("");
          const buffered = mode === "buffered" || mode === "sync";
          const info = new TextDecoder().decode(buffered ? files.get("/density")! : await fs.readFile("/density"));
          const [actualX, actualY, actualUnits] = info.split("|");
          expect(Number(actualX)).toBeCloseTo(sourceX * (resample ? 2 : 1), 10);
          expect(Number(actualY)).toBeCloseTo(sourceY * (resample ? 2 : 1), 10);
          expect(actualUnits).toBe(units);
          const output = readImageMetadata(buffered ? files.get("/out.miff")! : await fs.readFile("/out.miff"));
          expect(output).toMatchObject({ width: resample ? 16 : 8, height: resample ? 10 : 5 });
          expect(output.resolution?.unit).toBe(expectedUnit);
          expect(output.resolution?.x).toBeCloseTo(sourceX * (resample ? 2 : 1), 10);
          expect(output.resolution?.y).toBeCloseTo(sourceY * (resample ? 2 : 1), 10);
        });
      }
    }
  }
}
