import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

function disposals(bytes: Uint8Array): number[] {
  const values: number[] = [];
  let offset = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  while (offset < bytes.length && bytes[offset] !== 59) {
    const kind = bytes[offset++];
    if (kind === 33) {
      if (bytes[offset++] === 249) values.push((bytes[offset + 1]! >>> 2) & 7);
    } else if (kind === 44) {
      const flags = bytes[offset + 8]!;
      offset += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1;
    } else throw new Error(`Unexpected GIF block ${kind}`);
    while (bytes[offset]) offset += 1 + bytes[offset]!;
    offset++;
  }
  return values;
}

for (const retained of [false, true]) {
  for (const [args, expected, delays] of [
    [["in.gif", "-set", "dispose", "previous"], [3, 3], [100, 200]],
    [["in.gif", "-set", "dispose", "Background"], [2, 2], [100, 200]],
    [["in.gif", "-set", "dispose", "none"], [1, 1], [100, 200]],
    [["in.gif", "-set", "dispose", "invalid"], [0, 0], [100, 200]],
    [["in.gif", "-set", "dispose", "0"], [0, 0], [100, 200]],
    [["in.gif", "-set", "dispose", "3", "in.gif", "-reverse"], [1, 1, 3, 3], [200, 100, 200, 100]],
    [["in.gif", "-set", "dispose", "previous", "-resize", "2x2!"], [3, 3], [100, 200]],
    [["in.gif[0]", "-set", "dispose", "previous", "(", "in.gif[1]", "-set", "dispose", "background", ")"], [3, 2], [100, 200]],
    [["in.gif[1]", "-set", "dispose", "previous"], [3], [200]],
    [["-set", "dispose", "previous", "in.gif"], [1, 1], [100, 200]],
  ] as const) {
    it(`sets disposal on existing frames: ${args.join(" ")} (retained=${retained})`, async () => {
      const pixels = new Uint8Array(3 * 3 * 2 * 4);
      for (let i = 0; i < 18; i++) pixels.set(i < 9 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
      const input = await sharp(pixels, { raw: { width: 3, height: 6, channels: 4 } })
        .gif({ pageHeight: 3, delay: [100, 200], loop: 0 }).toBuffer();
      const files = new Map([["in.gif", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/in.gif", input);
      expect(await runConvertCli([...args, "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toMatchObject({ exitCode: 0 });
      const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
      expect(disposals(output)).toEqual(expected);
      expect((await sharp(output, { animated: true }).metadata()).delay).toEqual(delays);
    });
  }
}
