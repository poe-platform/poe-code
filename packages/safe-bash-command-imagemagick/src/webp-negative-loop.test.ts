import { expect, it } from "vitest";
import { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    for (const lossless of [false, true]) {
      it.each([-1, -2, -65536, 0, 1, 65535])(`handles WebP loop %i (retained=${retained}, write=${write}, lossless=${lossless})`, async (loop) => {
        const original = new TextEncoder().encode("keep existing output");
        const files = new Map([["/out.webp", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.webp", original);
        const result = await runConvertCli([
          "-delay", "2", "xc:red", "-delay", "3", "xc:blue", "-loop", String(loop),
          "-define", `webp:lossless=${lossless}`,
          ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])
        ], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(loop < 0 ? 1 : 0);
        const output = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
        if (loop < 0) {
          expect(result.stderr).toContain("Invalid WebP loop count");
          expect(output).toEqual(original);
        } else {
          expect(readImageMetadata(output)).toMatchObject({ pages: 2, loop, delay: [20, 30] });
        }
      });
    }
  }
}
