import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick -size 3x1 -delay 8 xc:red -delay 0 xc:lime -delay 13 xc:blue -delay 21 xc:blue -loop 4 seq.gif
const input = Buffer.from("R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAAAAAAALAAAAAADAAEAgAD/AAAAAAIChAsAIfkEAA0AAAAsAAAAAAMAAQCAAAD/AAAAAgKECwAh+QQAFQAAACwAAAAAAwABAIAAAP8AAAACAoQLADs=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { selection: "in.gif", options: [], delays: [80, 0, 130, 210], colors: [0, 1, 2, 2] },
    { selection: "in.gif", options: ["-layers", "RemoveZero"], delays: [80, 130, 210], colors: [0, 2, 2] },
    { selection: "in.gif[1,0,1]", options: ["-layers", "removezero"], delays: [80], colors: [0] },
    { selection: "in.gif[2,3]", options: ["-layers", "RemoveZero"], delays: [130, 210], colors: [2, 2] },
    { selection: "in.gif[1,1]", options: ["-layers", "RemoveZero"], delays: [0, 0], colors: [1, 1] },
  ])(`${mode} removes only zero-delay frames: %j`, async ({ selection, options, delays, colors }) => {
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = [selection, ...options, "out.gif"];
    let stderr = "";
    const result = mode === "command" ? {
      ...await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      }), stderr,
    } : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(delays.every(delay => delay === 0) ? "magick: animation only contains zero time delays\n" : "");
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!, { animated: true });
    expect(output.delay).toEqual(delays);
    // A single surviving GIF frame has no animation loop extension.
    expect(output.loop).toBe(colors.length === 1 ? undefined : decodeImage(input, { animated: true }).loop);
    expect([...output.data]).toEqual(colors.flatMap(channel => Array.from({ length: 3 }, () => [channel === 0 ? 255 : 0, channel === 1 ? 255 : 0, channel === 2 ? 255 : 0, 255]).flat()));
  });
}
