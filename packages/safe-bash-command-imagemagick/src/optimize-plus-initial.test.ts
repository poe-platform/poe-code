import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const red = [255, 0, 0, 255];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([false, true])(`${mode} trims only transparent initial pixels (opaque=%s)`, async opaque => {
    const data = new Uint8Array(Array.from({ length: 6 }, () => opaque ? red : [0, 0, 0, 0]).flat());
    const input = encodeImage({ width: 3, height: 2, pageHeight: 1, pages: 2,
      data, disposal: [1, 1], delay: [30, 60], loop: 4,
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
    expect(output.delay).toEqual([30, 60]);
    expect(output.loop).toBe(4);
    expect(output.data).toEqual(decodeImage(input, { animated: true }).data);
    for (const page of [0, 1]) {
      expect(decodeImage(bytes, { page, coalesce: false })).toMatchObject({
        width: page === 0 && opaque ? 3 : 1, height: 1,
        virtualCanvas: { width: 3, height: 1, x: 0, y: 0 }, disposal: 1,
      });
    }
  });
}
