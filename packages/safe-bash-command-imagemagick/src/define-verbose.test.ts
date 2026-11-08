import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const restore of [false, true]) it(`clears and restores verbose without clearing mean-color (${mode}, restore=${restore})`, async () => {
  const args = ["xc:red", "xc:blue", "+append", "-define", "connected-components:mean-color=true",
   "-define", "connected-components:verbose=true", "+define", "connected-components:verbose",
   ...(restore ? ["-define", "connected-components:verbose=true"] : []), "-connected-components", "4", "out.png"];
  const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
  const result = mode === "sync" ? runConvertCliSync(args, files)
   : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: restore
   ? "Objects (id: bounding-box centroid area mean-color):\n  0: 1x1+0+0 0.0,0.0 1 srgb(255,0,0)\n  1: 1x1+1+0 1.0,0.0 1 srgb(0,0,255)\n"
   : "" });
  expect([...decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!).data])
   .toEqual([255,0,0,255,0,0,255,255]);
 });
}
