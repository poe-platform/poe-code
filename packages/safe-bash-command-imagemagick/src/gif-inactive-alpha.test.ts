import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
  for (const color of ["#ff000000", "#ff000080", "red"]) {
    for (const dither of [[], ["-dither", "FloydSteinberg"], ["+dither"]]) {
      it(`preserves visible GIF color with alpha off: ${mode}, ${color}, ${dither}`, async () => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = [
          `xc:${color}`, "-alpha", "off", ...dither,
          "-write", "/copy.gif", "-depth", "8", "-write", "/visible.rgba", "/out.gif"
        ];
        const result = mode === "sync"
          ? runMagickCliSync(args, files)
          : await createMagickCommand().execute({
              command: "magick", args: createCommandArguments(args).args,
              cwd: "/", env: {}, fs,
              stdin: (async function* () {})(), signal: new AbortController().signal,
              stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        for (const path of ["/copy.gif", "/out.gif", "/visible.rgba"]) {
          const bytes = mode === "sync" ? files.get(path)! : await fs.readFile(path);
          expect(Array.from(path.endsWith(".gif") ? decodeImage(bytes).data : bytes)).toEqual([
            255, 0, 0, 255
          ]);
        }
      });
    }
  }
}
