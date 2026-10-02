import { afterEach, expect, test, vi } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

for (const args of [["in.png", "-colorspace", "Gray", "out.png"], ["in.png", "-alpha", "transparent", "out.png"], ["-size", "256x256", "xc:blue", "out.png"], ["in.png", "-resize", "64x64", "-blur", "0x0.5", "out.png"], ["in.png", "-crop", "192x192+0+0", "-flip", "-rotate", "90", "out.png"], ["in.png", "-format", "%[opaque]|%[type]|%[standard-deviation]", "info:"]]) {
  for (const cancel of [false, true]) {
    test(`pixel processing yields with a frozen clock: ${args.join(" ")} (cancel=${cancel})`, async () => {
      const bytes = encodeImage({ width: 256, height: 256, data: new Uint8Array(256 * 256 * 4).fill(255), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
      const files = new Map([["in.png", bytes]]);
      vi.stubGlobal("setImmediate", undefined);
      vi.spyOn(Date, "now").mockReturnValue(0);
      vi.spyOn(performance, "now").mockReturnValue(0);
      const controller = new AbortController();
      const reason = new Error("cancel pixels");
      const timer = globalThis.setTimeout;
      let turns = 0;
      vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number) => timer(() => {
        turns++;
        if (cancel && turns === 5) controller.abort(reason);
        callback();
      }, ms)) as typeof setTimeout);
      const run = runConvertCli(args, files, undefined, controller.signal);
      if (cancel) {
        const result = await run.catch(error => { expect(error).toBe(reason); return { exitCode: 1 }; });
        expect(controller.signal.aborted).toBe(true);
        expect(result.exitCode).not.toBe(0);
        expect(files.has("out.png")).toBe(false);
      } else expect((await run).exitCode).toBe(0);
      expect(turns).toBeGreaterThan(0);
    });
  }
}
