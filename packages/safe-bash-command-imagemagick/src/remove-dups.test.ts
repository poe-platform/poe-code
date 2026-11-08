import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

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
