import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// Native ImageMagick: -size 8x8 -delay 12 xc:red -delay 31 xc:blue gif:-
const input = Buffer.from("R0lGODlhCAAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAACAAIAAACB4SPqcvtXQAAIfkEAB8AAAAsAAAAAAgACACAAAD/AAAAAgeEj6nL7V0AADs=", "base64");

for (const retained of [false, true]) {
  for (const geometry of ["4x3+1+1", "4x3+99+99"]) {
    it.each([false, true])(`preserves GIF frame timing through extent (retained=${retained}, extent=${geometry}, reverse=%s)`, async reverse => {
      const files = new Map([["in.gif", new Uint8Array(input)]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", input);
      expect(await runMagickCli(["in.gif", ...(reverse ? ["-reverse"] : []), "-extent", geometry, "out.gif"], retained ? { filesystem, cwd: "/" } : files))
        .toMatchObject({ exitCode: 0 });
      const output = decodeImage(retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!, { animated: true });
      expect(output).toMatchObject({ width: 4, height: 6, pages: 2, pageHeight: 3, delay: reverse ? [310, 120] : [120, 310] });
      const colors = geometry === "4x3+99+99" ? (reverse ? [[255, 255, 255, 255], [255, 0, 0, 255]] : [[255, 0, 0, 255], [255, 255, 255, 255]]) : reverse ? [[0, 0, 255, 255], [255, 0, 0, 255]] : [[255, 0, 0, 255], [0, 0, 255, 255]];
      expect(output.data).toEqual(Uint8Array.from(colors.flatMap(color => Array.from({ length: 12 }, () => color).flat())));
    });
  }
}
