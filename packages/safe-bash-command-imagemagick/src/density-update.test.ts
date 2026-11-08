import { expect, it } from "vitest";
import { encodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const format of ["jpeg", "png", "tiff"] as const) {
    it(`updates raster density in order without resizing (${mode}, ${format})`, async () => {
      const input = encodeImage({ width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255),
        format, space: "srgb", channels: 3, depth: "uchar", density: 144, hasAlpha: false,
        resolution: { x: 144, y: 72, unit: "inch" } }, { format }).data;
      const fs = new MemoryFileSystem(), files = new Map([[`/input.${format}`, input]]);
      await fs.writeFile(`/input.${format}`, input);
      const args = [`/input.${format}`, "-density", "300x150", "-write", `/first.${format}`,
        "-set", "density", "200x100", "-write", `/second.${format}`, "-density", "96", `/final.${format}`];
      const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      for (const [name, x, y] of [["first", 300, 150], ["second", 200, 100], ["final", 96, 96]] as const) {
        const path = `/${name}.${format}`;
        const meta = readImageMetadata(mode === "buffered" ? files.get(path)! : await fs.readFile(path));
        expect(meta).toMatchObject({ width: 2, height: 1, resolution: {
          x: format === "png" ? x * 100 : x, y: format === "png" ? y * 100 : y,
          unit: format === "png" ? "meter" : "inch",
        } });
      }
    });
  }
}
