import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: red/8, red/7, blue/13, blue/21; loop 4.
const input = Buffer.from("R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAAHAAAALAAAAAADAAEAAAIChAsAIfkEAA0AAAAsAAAAAAMAAQCAAAD/AAAAAgKECwAh+QQAFQAAACwAAAAAAwABAIAAAP8AAAACAoQLADs=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { selection: "in.gif", delays: [80, 70, 340], colors: [0, 0, 2], widths: [3, 1, 3] },
    { selection: "in.gif[0,1,0,1]", delays: [80, 220], colors: [0, 0], widths: [3, 1] },
    { selection: "in.gif[0,2,3]", delays: [80, 340], colors: [0, 2], widths: [3, 3] },
    { selection: "in.gif[0]", delays: [80], colors: [0], widths: [3] },
  ])(`${mode} matches native OptimizePlus timing: %j`, async ({ selection, delays, colors, widths }) => {
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = [selection, "-layers", "OptimizePlus", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const output = decodeImage(bytes, { animated: true });
    expect(output.delay).toEqual(delays);
    expect(output.loop).toBe(decodeImage(input, { animated: true }).loop);
    expect([...output.data]).toEqual(colors.flatMap(channel => Array.from({ length: 3 }, () => [channel === 0 ? 255 : 0, 0, channel === 2 ? 255 : 0, 255]).flat()));
    const rectangles: number[] = [], disposals: number[] = [];
    let at = 13 + 3 * (1 << ((bytes[10]! & 7) + 1));
    while (bytes[at] !== 59) {
      const marker = bytes[at++];
      if (marker === 33) {
        if (bytes[at] === 249) disposals.push((bytes[at + 2]! >> 2) & 7);
        at++;
      } else {
        expect(marker).toBe(44);
        rectangles.push(bytes[at + 4]! | bytes[at + 5]! << 8);
        const flags = bytes[at + 8]!;
        at += 10 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0);
      }
      while (bytes[at]) at += bytes[at]! + 1;
      at++;
    }
    expect(rectangles).toEqual(widths);
    expect(disposals).toEqual(widths.map(() => 1));
  });
}
