import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const report = "Objects (id: bounding-box centroid area mean-color):\n  0: 1x1+0+0 0.0,0.0 1 srgb(255,0,0)\n  1: 1x1+1+0 1.0,0.0 1 srgb(0,0,255)\n";
for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const [settings, verbose] of [
    [["-set", "option:connected-components:verbose", "true"], true],
    [["-set", "option:connected-components:verbose", "false"], false],
    [["-define", "connected-components:verbose=true", "-set", "option:connected-components:verbose", "false"], false],
    [["-set", "option:connected-components:verbose", "false", "-define", "connected-components:verbose=true"], true],
  ] as const) {
    it(`applies ${settings.join(" ")} (${mode})`, async () => {
      const args = ["xc:red", "xc:blue", "+append", ...settings, "-connected-components", "4", "null:"];
      const result = mode === "sync"
        ? runConvertCliSync(args, new Map())
        : await runConvertCli(args, mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: verbose ? report : "" });
    });
  }
}
