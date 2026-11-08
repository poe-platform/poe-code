import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const operation of [["-flatten"], ["-layers", "Flatten"], ["-layers", "Merge"], ["-mosaic"], ["-layers", "Mosaic"]]) {
    it.each([false, true])(`${mode} ${operation.join(" ")} preserves first-frame delay (reverse=%s)`, async reverse => {
      const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
      const input = await sharp(Uint8Array.from([...red, ...red, ...red, ...red, ...red, ...blue]), { raw: { width: 3, height: 2, channels: 4 } })
        .gif({ pageHeight: 1, delay: [80, 130], loop: 4 }).toBuffer();
      const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", input);
      const args = ["in.gif", ...(reverse ? ["-reverse"] : []), ...operation, "out.gif"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!, { animated: true });
      expect(output).toMatchObject({ width: 3, height: 1, delay: [reverse ? 130 : 80] });
      expect(output.data).toEqual(Uint8Array.from([...red, ...red, ...(reverse ? red : blue)]));
    });
  }
}
