import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: red/8, red/7, blue/13, blue/21; loop 4.
const input = Buffer.from("R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAAHAAAALAAAAAADAAEAAAIChAsAIfkEAA0AAAAsAAAAAAMAAQCAAAD/AAAAAgKECwAh+QQAFQAAACwAAAAAAwABAIAAAP8AAAACAoQLADs=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([2, 3])(`${mode} writes a transparent OptimizePlus pause in %i frames`, async frames => {
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = [`in.gif[0-${frames - 1}]`, "-layers", "OptimizePlus", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(decodeImage(bytes, { page: 1, coalesce: false })).toMatchObject({
      width: 1, height: 1, virtualCanvas: { width: 3, height: 1, x: 0, y: 0 },
      data: new Uint8Array(4), disposal: 1,
    });
    expect(decodeImage(bytes, { animated: true })).toMatchObject({
      delay: [80, 70, 130].slice(0, frames), loop: 4,
      data: decodeImage(input, { animated: true }).data.slice(0, frames * 3 * 4),
    });
  });
}
