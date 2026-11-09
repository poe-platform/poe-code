import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) for (const write of [false, true]) {
  it.each(["in.gif[1]", "in.gif[0-1]"])("publishes loop metadata for %s (retained=" + retained + ", write=" + write + ")", async source => {
    const pixels = Uint8Array.of(255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255);
    const input = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
      .gif({ pageHeight: 1, delay: [70, 130], loop: 4 }).toBuffer();
    const files = new Map([["in.gif", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    expect(await runConvertCli([source, ...(write ? ["-write", "out.gif", "null:"] : ["out.gif"])], retained ? { filesystem: fs, cwd: "/" } : files))
      .toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    const single = source === "in.gif[1]";
    if (single) expect(extension).toBe(-1);
    else {
      expect(extension).toBeGreaterThan(-1);
      expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 3, 0, 0]);
    }
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ delay: single ? [130] : [70, 130] });
    expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(single ? pixels.subarray(8) : pixels);
  });
}
