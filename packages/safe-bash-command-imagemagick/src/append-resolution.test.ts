import { expect, it } from "vitest";
import { encodeImage, readImageMetadata, type ImageMetadata } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick keeps the first input's pHYs for either append direction.
const resolutions: ImageMetadata["resolution"][] = [
  { x: 5905, y: 11811, unit: "meter" },
  { x: 2834, y: 3543, unit: "meter" },
  { x: 150, y: 300, unit: "unknown" },
  undefined,
];
const inputs = resolutions.map(resolution => encodeImage({
  width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255),
  format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
  ...(resolution ? { resolution } : {}),
}, { format: "png" }).data);

for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const direction of ["+append", "-append"]) {
    it.each([[0, 1], [1, 0], [2, 0], [3, 0], [0]])(
      `${mode} ${direction} retains the first resolution for inputs %j`, async (...order) => {
        const files = new Map(inputs.map((input, index) => [`/${index}.png`, input]));
        const fs = createMemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = [...order.map(index => `/${index}.png`), direction, "/out.png"];
        const result = mode === "command"
          ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
          })
          : mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = readImageMetadata(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        const first = readImageMetadata(inputs[order[0]!]!);
        expect(first.resolution).toEqual(resolutions[order[0]!]);
        expect(output.resolution).toEqual(first.resolution);
        expect(output.density).toBe(first.density);
        expect([output.width, output.height]).toEqual(direction === "+append" ? [order.length, 1] : [1, order.length]);
      },
    );
  }
}
