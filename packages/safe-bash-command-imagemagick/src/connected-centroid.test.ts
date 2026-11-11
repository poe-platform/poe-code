import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const connectivity of [4, 8]) it(`rounds centroid ties to even (${mode}, ${connectivity})`, async () => {
  const args = ["-size", "5x4", "xc:black", "-fill", "white", "-draw", "rectangle 0,0 0,2 point 1,0", "-alpha", "off", "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "null:"];
  const files = new Map<string, Uint8Array>();
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: new MemoryFileSystem(), cwd: "/" });
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "Objects (id: bounding-box centroid area mean-color):\n  1: 5x4+0+0 2.4,1.7 16 srgb(0,0,0)\n  0: 2x3+0+0 0.2,0.8 4 srgb(255,255,255)\n" });
 });
}
