import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick: red 3x2+2+3, blue 2x2+5+4 on a 9x8 canvas.
const fixture = "R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwCAAMAAwACAAACAoRfACH5BAAXAAAALAUABAACAAIAgAAA/wAAAAIChFEAOw==";

// Native output supplies the expected playback, including the opaque red GIF background.
const optimized = "R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQEBwAAACwAAAAACQAIAAACB4SPqcvtrwoAIfkEBBcAAAAsBQAEAAIAAgCAAAD/AAAAAgKEUQA7";

for (const retained of [false, true]) {
  it(`optimizes coalesced GIF frames with native rectangles and playback (retained=${retained})`, async () => {
    const input = new Uint8Array(Buffer.from(fixture, "base64"));
    const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    expect(await runConvertCli(["in.gif", "-coalesce", "-layers", "oPtImIzEfRaMe", "out.gif"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    for (const [page, width, height, x, y] of [[0, 9, 8, 0, 0], [1, 2, 2, 5, 4]] as const) {
      expect(decodeImage(output, { page, coalesce: false })).toMatchObject({
        width, height, virtualCanvas: { width: 9, height: 8, x, y }, disposal: 1
      });
    }
    const decoded = decodeImage(output, { animated: true });
    expect(decoded).toMatchObject({ delay: [70, 230], loop: 4 });
    expect(decoded.data).toEqual(decodeImage(new Uint8Array(Buffer.from(optimized, "base64")), { animated: true }).data);
  });

  it(`rejects uncoalesced frames without overwriting the output (retained=${retained})`, async () => {
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
