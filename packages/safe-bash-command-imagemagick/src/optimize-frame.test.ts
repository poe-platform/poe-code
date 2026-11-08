import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick: red 3x2+2+3, blue 2x2+5+4 on a 9x8 canvas.
const fixture = "R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwCAAMAAwACAAACAoRfACH5BAAXAAAALAUABAACAAIAgAAA/wAAAAIChFEAOw==";

// Native output supplies the expected playback, including the opaque red GIF background.
const optimized = "R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQEBwAAACwAAAAACQAIAAACB4SPqcvtrwoAIfkEBBcAAAAsBQAEAAIAAgCAAAD/AAAAAgKEUQA7";

for (const mode of ["buffered", "retained", "command"]) {
  const retained = mode !== "buffered";
  it.each([{ options: ["-coalesce", "-layers", "oPtImIzEfRaMe"] }, { options: ["-layers", "Optimize"] }, { options: [] }])(`optimizes GIF frames with native rectangles and playback (mode=${mode}, options=$options)`, async ({ options }) => {
    const input = new Uint8Array(Buffer.from(fixture, "base64"));
    const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = ["in.gif", ...options, "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    for (const [page, width, height, x, y] of [options.length ? [0, 9, 8, 0, 0] as const : [0, 3, 2, 2, 3] as const, [1, 2, 2, 5, 4]] as const) {
      expect(decodeImage(output, { page, coalesce: false })).toMatchObject({
        width, height, virtualCanvas: { width: 9, height: 8, x, y }, disposal: options.length ? 1 : 0
      });
    }
    const decoded = decodeImage(output, { animated: true });
    expect(decoded).toMatchObject({ delay: [70, 230], loop: 4 });
    expect(decoded.data).toEqual(decodeImage(new Uint8Array(Buffer.from(options.length ? optimized : fixture, "base64")), { animated: true }).data);
  });

  it(`rejects uncoalesced frames without overwriting the output (mode=${mode})`, async () => {
    const input = new Uint8Array(Buffer.from(fixture, "base64"));
    const files = new Map([["in.gif", input], ["out.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    await filesystem.writeFile("/out.gif", input);
    expect(await runConvertCli(["in.gif", "-layers", "OptimizeFrame", "out.gif"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({
      exitCode: 1, stderr: expect.stringContaining("image pages are not coalesced")
    });
    expect(retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")).toEqual(input);
  });
}
