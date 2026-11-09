import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";

for (const input of ["jpeg", "png"] as const) {
  const { data: fixture } = encodeImage({ width: 24, height: 16, data: new Uint8Array(24 * 16 * 4).fill(255), format: input, space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: 6 }, { format: input });
  for (const mode of ["buffered", "retained"] as const) for (const output of ["jpeg", "png"] as const) {
    it.each(["keep", "strip", "orient-strip", "strip-orient"])(`EXIF operation=%s (${input}/${mode}/${output})`, async operation => {
      const orient = operation === "orient-strip" || operation === "strip-orient";
      const fs = new MemoryFileSystem(), files = new Map([["/input", fixture]]);
      await fs.writeFile("/input", fixture);
      const path = `/output.${output}`;
      const options = operation === "strip-orient" ? ["-strip", "-auto-orient"] : orient ? ["-auto-orient", "-strip"] : operation === "strip" ? ["-strip"] : [];
      expect(await runConvertCli(["/input", ...options, path], mode === "buffered" ? files : { filesystem: fs, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const bytes = mode === "buffered" ? files.get(path)! : await fs.readFile(path);
      // Inspect the encoded profile marker independently of the decoder's metadata handling.
      expect(new TextDecoder("latin1").decode(bytes).includes(output === "jpeg" ? "Exif\0\0" : "eXIf")).toBe(operation === "keep");
      const image = decodeImage(bytes);
      expect([image.width, image.height]).toEqual(orient ? [16, 24] : [24, 16]);
      if (operation === "keep") expect(image.orientation).toBe(6);
      else if (output === "jpeg") expect(image.orientation).toBeUndefined();
    });
  }
}
