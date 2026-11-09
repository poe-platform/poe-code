import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Distinct RGBA8 pixels with PNG eXIf orientation 6. Native ImageMagick
// 7.1.2-35 Q16-HDRI preserves these pixels through HSL/HWB/XYZ round trips.
const fixture = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAYAAABbNsX4AAAAGmVYSWZJSSoACAAAAAEAEgEDAAEAAAAGAAAAAAAAALdIESkAAABKSURBVHicAT8AwP8ABj51rTdupt1nn9YNl88GPsj/N24A+DBnnihgl89ZkMj/icH4L7nxKGAA6iFZkBpRicBKgrnxe7LqIaviGlG+uB9K4cQBrAAAAABJRU5ErkJggg==", "base64"));
const source = decodeImage(fixture);
const orders = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  [4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 14, 13, 12, 11, 10],
  [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  [10, 11, 12, 13, 14, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4],
  [0, 5, 10, 1, 6, 11, 2, 7, 12, 3, 8, 13, 4, 9, 14],
  [10, 5, 0, 11, 6, 1, 12, 7, 2, 13, 8, 3, 14, 9, 4],
  [14, 9, 4, 13, 8, 3, 12, 7, 2, 11, 6, 1, 10, 5, 0],
  [4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11, 0, 5, 10],
];

for (const mode of ["buffered", "retained", "sync", "command"]) {
  for (const colorspace of ["HSL", "HWB", "XYZ"]) {
    it.each(orders.map((order, index) => ({ order, orientation: index + 1 })))(
      `${mode} auto-orients ${colorspace} samples for EXIF $orientation`, async ({ order, orientation }) => {
        const input = orientation === 6 ? fixture : encodeImage({ ...source, orientation }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "-colorspace", colorspace, "-auto-orient", "-colorspace", "sRGB", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output).toMatchObject({ width: orientation >= 5 ? 3 : 5, height: orientation >= 5 ? 5 : 3, orientation: 1 });
        expect(Array.from(output.data)).toEqual(order.flatMap(index => Array.from(source.data.subarray(index * 4, index * 4 + 4))));
      },
    );
  }
}
