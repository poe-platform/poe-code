import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: RBR/3, RTR/6, optionally GBR/9; None disposal and loop 4.
const fixtures = [
  "R0lGODlhAwABAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEDAAAh+QQEAwAAACwAAAAAAwABAAACAkRQACH5BAUGAAAALAAAAAADAAEAgAAAAP8AAAICDFIAOw==",
  "R0lGODlhAwABAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEDAAAh+QQEAwAAACwAAAAAAwABAAACAkRQACH5BAUGAAAALAAAAAADAAEAgAAAAP8AAAICDFIAIfkEBAkAAAAsAAAAAAMAAQCB/wAAAP8AAAD/AAAAAgKMUAA7",
];
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], green = [0, 255, 0, 255];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each(fixtures)(`${mode} clears opaque pixels replaced by transparency: %s`, async fixture => {
    const input = Buffer.from(fixture, "base64");
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
    const third = fixture === fixtures[1];
    expect(output.delay).toEqual(third ? [0, 30, 60, 90] : [0, 30, 60]);
    expect(output.loop).toBe(4);
    expect([...output.data]).toEqual([
      ...red, ...blue, ...red, ...red, ...blue, ...red,
      ...red, 0, 0, 0, 0, ...red,
      ...(third ? [...green, ...blue, ...red] : []),
    ]);
    expect(decodeImage(bytes, { page: 1, coalesce: false })).toMatchObject({
      width: 1, height: 1, virtualCanvas: { width: 3, height: 1, x: 1, y: 0 }, disposal: 2,
    });
  });
}
