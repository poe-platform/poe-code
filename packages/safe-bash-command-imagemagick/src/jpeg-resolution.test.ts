import { expect, it } from "vitest";
import { encodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

const raster = {
  width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255),
  format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
} as const;

for (const mode of ["buffered", "retained", "command"]) {
  for (const tagged of [false, true]) {
    for (const override of [false, true]) {
      it(`preserves JPEG resolution provenance (${mode}, tagged=${tagged}, override=${override})`, async () => {
        const input = encodeImage({ ...raster, ...(tagged ? { resolution: { x: 4000, y: 2000, unit: "meter" as const } } : {}) }, { format: "png" }).data;
        expect(readImageMetadata(input).resolution).toEqual(tagged ? { x: 4000, y: 2000, unit: "meter" } : undefined);
        const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
        await fs.writeFile("/input.png", input);
        const args = ["/input.png", ...(override ? ["-units", "PixelsPerInch", "-density", "144x72"] : []), "/output.jpg"];
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
          args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } })
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" ? files.get("/output.jpg")! : await fs.readFile("/output.jpg");
        expect(Array.from(output.subarray(0, 11))).toEqual([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0]);
        expect(Array.from(output.subarray(13, 18))).toEqual(override ? [1, 0, 144, 0, 72] : tagged ? [2, 0, 40, 0, 20] : [0, 0, 1, 0, 1]);
      });
    }
  }
}

it("honors an explicit JPEG encoder density without source resolution", () => {
  const { data } = encodeImage(raster, { format: "jpeg", density: 144 });
  expect(Array.from(data.subarray(13, 18))).toEqual([1, 0, 144, 0, 144]);
});
