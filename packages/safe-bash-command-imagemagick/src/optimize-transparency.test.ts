import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: 3x1 red, then red/red/blue; delays 8/13 and loop 4.
const input = Buffer.from("R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAANAAAALAAAAAADAAEAgP8AAAAA/wICBFIAOw==", "base64");
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([0, 1, 2, 3])(`${mode} preserves playback and geometry with disposal %i`, async (disposal) => {
    const fixture = Buffer.from(input);
    for (let at = fixture.indexOf(Buffer.from([33, 249, 4])); at !== -1; at = fixture.indexOf(Buffer.from([33, 249, 4]), at + 1)) fixture[at + 3] = disposal << 2;
    const files = new Map<string, Uint8Array>([["in.gif", fixture]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", fixture);
    const args = ["in.gif[0,1,1]", "-layers", "OptimizeTransparency", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const output = decodeImage(bytes, { animated: true });
    const original = decodeImage(fixture, { animated: true });
    expect(output.data).toEqual(new Uint8Array([...original.data, ...original.data.subarray(12)]));
    expect(output.delay).toEqual([80, 130, 130]);
    expect(output.loop).toBe(original.loop);
    for (const page of [0, 1, 2]) {
      expect(decodeImage(bytes, { page, coalesce: false })).toMatchObject({ width: 3, height: 1, virtualCanvas: { x: 0, y: 0 } });
    }
    if (disposal < 2) expect([...decodeImage(bytes, { page: 2, coalesce: false }).data].filter((_, index) => index % 4 === 3)).toEqual([0, 0, 0]);
    expect([...decodeImage(bytes, { page: 1, coalesce: false }).data].map((value, index, data) => data[index - index % 4 + 3] === 0 ? 0 : value)).toEqual(disposal < 2 ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255] : [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  });
}
