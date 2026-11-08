import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const bytes = readFileSync(new URL("./fixtures/component-stripes.png", import.meta.url));
for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const background of [0, 2]) for (const reset of [false, true]) {
  it(`protects the selected background during area filtering (${mode}, id=${background}, reset=${reset})`, async () => {
   const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
   await fs.writeFile("/input.png", bytes);
   const args = ["input.png", "-define", `connected-components:background-id=${background}`, ...(reset ? ["+define", "connected-components:background-id"] : []), "-define", "connected-components:area-threshold=3", "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"];
   const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
   expect(result.stderr).toBe("");
   expect(result.exitCode).toBe(0);
   const id = reset ? 0 : background;
   expect(result.stdout).toBe(`Objects (id: bounding-box centroid area mean-color):\n  ${id}: 5x1+0+0 2.0,0.0 5 srgb(${id === 2 ? "0,128,0" : "255,0,0"})\n`);
   const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
   expect(Array.from(image.data16!).filter((_, i) => i % 4 === 0)).toEqual([id, id, id, id, id]);
  });
 }
}
