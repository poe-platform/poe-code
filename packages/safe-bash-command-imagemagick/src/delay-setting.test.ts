import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const [args, delays] of [
    [["in.gif", "-delay", "15"], [100, 200]],
    [["-delay", "15", "in.gif"], [150, 150]],
    [["in.gif", "-delay", "15", "in.gif"], [100, 200, 150, 150]],
    [["-delay", "15", "in.gif", "-delay", "25", "in.gif", "-reverse"], [250, 250, 150, 150]],
    [["-size", "3x3", "-delay", "10", "xc:red", "-delay", "20", "xc:blue"], [100, 200]],
    [["-delay", "15", "in.gif[1]", "-delay", "25"], [150]],
    [["-delay", "0", "in.gif"], [0, 0]],
    [["-size", "3x1", "-delay", "12x50", "xc:red", "-delay", "3x25", "xc:blue"], [240, 120]],
    [["in.gif", "-delay", "12x50", "in.gif", "-delay", "3x25"], [100, 200, 240, 240]],
    [["-delay", "12x50", "in.gif", "-delay", "24", "in.gif"], [240, 240, 240, 240]],
    [["-size", "3x1", "-delay", "1x60", "xc:red", "-delay", "12x0", "xc:blue"], [10, 12000]],
  ] as const) {
    it(`applies delay only to subsequent inputs: ${args.join(" ")} (retained=${retained})`, async () => {
      const pixels = new Uint8Array(3 * 3 * 2 * 4);
      for (let i = 0; i < 18; i++) pixels.set(i < 9 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
      const input = await sharp(pixels, { raw: { width: 3, height: 6, channels: 4 } })
        .gif({ pageHeight: 3, delay: [100, 200], loop: 0 }).toBuffer();
      const files = new Map([["in.gif", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/in.gif", input);
      expect(await runConvertCli([...args, "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toMatchObject({ exitCode: 0 });
      const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
      expect((await sharp(output, { animated: true }).metadata()).delay).toEqual(delays);
    });
  }
}
