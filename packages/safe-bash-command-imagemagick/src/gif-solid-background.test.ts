import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it.each([
    ["red", [255, 0, 0]],
    ["lime", [0, 255, 0]],
    ["white", [255, 255, 255]],
    ["black", [0, 0, 0]],
    ["#123456", [18, 52, 86]],
  ] as const)(`uses the solid %s color for the GIF canvas (${mode})`, async (color, rgb) => {
    for (const exposed of [true, false]) {
      const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
      const args = ["-size", "2x1", `xc:${color}`, "-repage", exposed ? "3x1+1+0" : "2x1+0+0", "gif:-"];
      const chunks: Uint8Array[] = [];
      let output: Uint8Array;
      if (mode === "command") {
        const result = await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        output = Buffer.concat(chunks);
      } else {
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        output = result.stdoutBytes!;
      }
      const background = output[11]!;
      expect(Array.from(output.slice(13 + background * 3, 16 + background * 3))).toEqual(rgb);
      const image = decodeImage(output, { coalesce: false });
      expect(image).toMatchObject({ width: 2, height: 1, virtualCanvas: { width: exposed ? 3 : 2, height: 1, x: exposed ? 1 : 0, y: 0 } });
      expect(Array.from(image.data)).toEqual([...rgb, 255, ...rgb, 255]);
    }
  });
}
