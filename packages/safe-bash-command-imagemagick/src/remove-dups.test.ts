import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick -size 3x1 -delay 8 xc:red -delay 7 xc:red -delay 13 xc:blue -delay 21 xc:blue -loop 4 dup.gif
const input = Buffer.from("R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAAHAAAALAAAAAADAAEAAAIChAsAIfkEAA0AAAAsAAAAAAMAAQCAAAD/AAAAAgKECwAh+QQAFQAAACwAAAAAAwABAIAAAP8AAAACAoQLADs=", "base64");

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each([
    { selection: "in.gif", options: [], delays: [80, 70, 130, 210], colors: [0, 0, 2, 2] },
    { selection: "in.gif", options: ["-layers", "RemoveDups"], delays: [150, 340], colors: [0, 2] },
    { selection: "in.gif[0,1,0]", options: ["-layers", "removedups"], delays: [230], colors: [0] },
    { selection: "in.gif[0,2,1]", options: ["-layers", "RemoveDups"], delays: [80, 130, 70], colors: [0, 2, 0] },
  ])(`${mode} combines only adjacent duplicates: %j`, async ({ selection, options, delays, colors }) => {
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = [selection, ...options, "out.gif"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!, { animated: true });
    expect(output.delay).toEqual(delays);
    expect(output.loop).toBe(decodeImage(input, { animated: true }).loop);
    expect([...output.data]).toEqual(colors.flatMap(channel => Array.from({ length: 3 }, () => [channel === 0 ? 255 : 0, 0, channel === 2 ? 255 : 0, 255]).flat()));
  });
}


// Native: green canvas, identical red frames with Previous then Background disposal, blue at +2+0.
const disposalInput = Buffer.from("R0lGODlhAwABAPAAAACAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQEAwAAACwAAAAAAwABAAACAoQLACH5BAwHAAAALAAAAAABAAEAgP8AAAAAAAICRAEAIfkECAsAAAAsAAAAAAEAAQCA/wAAAAAAAgJEAQAh+QQEDQAAACwCAAAAAQABAIAAAP8AAAACAkQBADs=", "base64");

for (const mode of ["sync", "buffered", "retained", "command"]) {
  it(`${mode} retains the last duplicate's disposal and subsequent playback`, async () => {
    const files = new Map([["in.gif", disposalInput]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", disposalInput);
    const args = ["in.gif", "-layers", "RemoveDups", "out.gif"];
    const arguments_ = createCommandArguments(args);
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {},
        signal: new AbortController().signal, fs: filesystem,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
        registerCleanup() {},
      } as unknown as CommandContext)
      : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained"
      ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(decodeImage(output, { animated: true }).delay).toEqual([30, 180, 130]);
    expect(decodeImage(output, { page: 1, coalesce: false })).toMatchObject({
      width: 1, height: 1, disposal: 2, virtualCanvas: { width: 3, height: 1, x: 0, y: 0 },
    });
    const finalFrame = decodeImage(output, { animated: true }).data.slice(-12);
    expect(finalFrame[3]).toBe(0);
    expect([...finalFrame.slice(4)]).toEqual([0, 128, 0, 255, 0, 0, 255, 255]);
  });
}
