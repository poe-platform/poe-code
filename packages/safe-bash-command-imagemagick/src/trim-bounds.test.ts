import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: 3x2 red at +2+3 and 2x2 blue at +5+4 on a 9x8 canvas, delays 7/23, loop 4.
const input = Buffer.from("R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwCAAMAAwACAAACAoRfACH5BAAXAAAALAUABAACAAIAgAAA/wAAAAIChFEAOw==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each(["TrimBounds", "trimbounds"])(`trims the occupied frame union with %s (${mode})`, async method => {
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = ["in.gif", "-layers", method, "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(decodeImage(output, { animated: true })).toMatchObject({ pages: 2, delay: [70, 230], loop: 4 });
    for (const page of [0, 1]) {
      const before = decodeImage(input, { page, coalesce: false });
      const after = decodeImage(output, { page, coalesce: false });
      expect(after).toMatchObject({
        width: before.width, height: before.height, disposal: before.disposal,
        virtualCanvas: { width: 5, height: 3, x: page === 0 ? 0 : 3, y: page === 0 ? 0 : 1 },
      });
      expect(after.data).toEqual(before.data);
    }
  });
}
