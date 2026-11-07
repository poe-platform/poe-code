import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";

// Native ImageMagick repeats the first frame's disposal canvas and timing.
const fixture = "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAANAAAALAAAAAADAAEAgP8AAAAA/wICBFIAOw==";
for (const retained of [false, true]) {
  it.each([0, 1, 2, 3])(`renders native post-disposal canvases for disposal %i (retained=${retained})`, async disposal => {
    const files = new Map([["in.gif", new Uint8Array(Buffer.from(fixture, "base64"))]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", files.get("in.gif")!);
    const context = retained ? { filesystem, cwd: "/" } : files;
    expect(await runConvertCli(["in.gif", "-set", "dispose", String(disposal), "-layers", "dIsPoSe", "out.gif"], context)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(decodeImage(output, { animated: true })).toMatchObject({ pages: 2, delay: [80, 80], loop: 4 });
    for (const page of [0, 1]) {
      const frame = decodeImage(output, { page, coalesce: false });
      expect(frame).toMatchObject({ width: 3, height: 1, disposal, virtualCanvas: { width: 3, height: 1, x: 0, y: 0 } });
      for (let pixel = 0; pixel < 3; pixel++) {
        expect(frame.data[pixel * 4 + 3]).toBe(disposal < 2 ? 255 : 0);
        if (disposal < 2) expect([...frame.data.slice(pixel * 4, pixel * 4 + 3)]).toEqual([255, 0, 0]);
      }
    }
  });
}
