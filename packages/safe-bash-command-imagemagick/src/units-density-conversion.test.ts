import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick TIFFs: 3x2 PPM tagged with -units <unit> -density 36x72.
const fixtures = [
  { unit: "PixelsPerInch", target: "PixelsPerCentimeter", x: 36 / 2.54, resample: "28.35x56.7", input: "SUkqABoAAAD/AAAA/wAAAP//7gCZEXckU4QUAAABAwABAAAAAwAAAAEBAwABAAAAAgAAAAIBAwADAAAAMAEAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABYBAwABAAAAAgAAABcBBAABAAAAEgAAABoBBQABAAAAEAEAABsBBQABAAAAGAEAABwBAwABAAAAAQAAAB4BBQABAAAAIAEAAB8BBQABAAAAKAEAACgBAwABAAAAAgAAACkBAwACAAAAAAABAD4BBQACAAAAZgEAAD8BBQAGAAAANgEAAAAAAAAkAAAAAQAAAEgAAAABAAAAAAAAAAEAAAAAAAAAAQAAAAgACAAIAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIAA=" },
  { unit: "PixelsPerCentimeter", target: "PixelsPerInch", x: 36 * 2.54, resample: "182.88x365.76", input: "SUkqABoAAAD/AAAA/wAAAP//7gCZEXckU4QUAAABAwABAAAAAwAAAAEBAwABAAAAAgAAAAIBAwADAAAAMAEAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABYBAwABAAAAAgAAABcBBAABAAAAEgAAABoBBQABAAAAEAEAABsBBQABAAAAGAEAABwBAwABAAAAAQAAAB4BBQABAAAAIAEAAB8BBQABAAAAKAEAACgBAwABAAAAAwAAACkBAwACAAAAAAABAD4BBQACAAAAZgEAAD8BBQAGAAAANgEAAAAAAAAkAAAAAQAAAEgAAAABAAAAAAAAAAEAAAAAAAAAAQAAAAgACAAIAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIAA=" }
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const fixture of fixtures) {
    for (const operation of ["unchanged", "convert", "resample"] as const) {
      it(`preserves physical density from ${fixture.unit}: ${operation} (${mode})`, async () => {
        const input = Buffer.from(fixture.input, "base64");
        const files = new Map<string, Uint8Array>([["/input.tif", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.tif", input);
        const args = ["/input.tif",
          ...(operation === "unchanged" ? [] : ["-units", fixture.target]),
          ...(operation === "resample" ? ["-filter", "point", "-resample", fixture.resample] : []),
          "-format", "%wx%h,%x,%y,%U", "info:/output.txt"];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "sync" || mode === "buffered" ? files.get("/output.txt")! : await fs.readFile("/output.txt");
        const [size, x, y, unit] = new TextDecoder().decode(output).split(",");
        expect(size).toBe(operation === "resample" ? "6x4" : "3x2");
        const expectedX = operation === "unchanged" ? 36 : operation === "convert" ? fixture.x : Number(fixture.resample.split("x")[0]);
        expect(Number(x)).toBeCloseTo(expectedX, 5);
        expect(Number(y)).toBeCloseTo(expectedX * 2, 5);
        expect(unit).toBe(operation === "unchanged" ? fixture.unit : fixture.target);
      });
    }
  }
}
