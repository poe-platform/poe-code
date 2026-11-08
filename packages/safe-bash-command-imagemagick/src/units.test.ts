import { expect, it } from "vitest";
import { encodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const format of ["jpeg", "png", "tiff"] as const) {
    for (const [units, unit, x, y] of [
      ["PixelsPerInch", "inch", 300, 150],
      ["PixelsPerCentimeter", "cm", 40, 20],
    ] as const) {
      it(`sets both resolution axes in ${units} (${mode}, ${format})`, async () => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255),
          format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
        await fs.writeFile("/input.png", input);
        const path = `/output.${format}`;
        const args = ["/input.png", "-units", units, "-density", `${x}x${y}`, path];
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
          args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } })
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const meta = readImageMetadata(mode === "buffered" ? files.get(path)! : await fs.readFile(path));
        const scale = format === "png" ? unit === "inch" ? 100 / 2.54 : 100 : 1;
        expect(meta).toMatchObject({ width: 2, height: 1, resolution: {
          x: Math.round(x * scale), y: Math.round(y * scale), unit: format === "png" ? "meter" : unit,
        } });
      });
    }
  }
}

for (const mode of ["buffered", "retained"] as const) {
  it(`applies units before input and relabels existing axes in order (${mode})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["-units", "PixelsPerInch", "-size", "2x1", "xc:red",
      "-density", "300x150", "-write", "/inch.tiff", "-units", "PixelsPerCentimeter", "/cm.tiff"],
      mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    for (const unit of ["inch", "cm"] as const) {
      const path = `/${unit}.tiff`;
      expect(readImageMetadata(mode === "buffered" ? files.get(path)! : await fs.readFile(path)))
        .toMatchObject({ resolution: { x: 300, y: 150, unit } });
    }
  });

  it(`rejects invalid resolution units (${mode})`, async () => {
    const result = await runConvertCli(["xc:red", "-units", "invalid", "/out.png"],
      mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("unrecognized units type");
  });
}
