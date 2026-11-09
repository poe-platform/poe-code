import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";


const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it(`${mode} optimizes full-sized frames with Previous disposal`, async () => {
    const input = encodeImage({ width: 3, height: 3, pageHeight: 1, pages: 3,
      data: new Uint8Array([...red, ...red, ...red, ...red, ...blue, ...red, ...red, ...red, ...red]),
      format: "raw", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false,
      disposal: [1, 3, 1], delay: [30, 60, 90], loop: 4,
    }, { format: "gif", pageHeight: 1 }).data;
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = ["in.gif", "-layers", "OptimizePlus", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const output = decodeImage(bytes, { animated: true });
    expect(output.delay).toEqual([30, 60, 90]);
    expect(output.loop).toBe(4);
    expect(output.data).toEqual(decodeImage(input, { animated: true }).data);
    for (const page of [0, 1, 2]) {
      expect(decodeImage(bytes, { page, coalesce: false })).toMatchObject({
        width: page === 0 ? 3 : 1, height: 1,
        virtualCanvas: { width: 3, height: 1, x: page === 0 ? 0 : 1, y: 0 }, disposal: 1,
      });
    }
  });
}
