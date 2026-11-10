import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
for (const optimize of [false, true])
for (const disposal of [1, 2, 3])
for (const transparent of [false, true])
it(`preserves GIF playback (retained=${retained}, optimize=${optimize}, disposal=${disposal}, transparent=${transparent})`, async () => {
  const first = decodeImage(await sharp({ create: { width: 3, height: 3, channels: 4, background: "red" } }).png().toBuffer());
  if (transparent) first.data[3] = 0;
  const data = new Uint8Array(4 * first.data.length);
  for (let i = 0; i < 4; i++) data.set(first.data, i * first.data.length);
  data.set([0, 0, 255, 255], first.data.length + 16);
  const input = encodeImage({ ...first, height: 12, pageHeight: 3, pages: 4, data, delay: [100, 200, 300, 400], disposal }, { format: "gif", pageHeight: 3 }).data;
  const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.gif", input);
  const backend = retained ? { filesystem, cwd: "/" } : files;
  expect(await runConvertCli(["in.gif", ...(optimize ? ["-layers", "Optimize"] : []), "out.gif"], backend)).toMatchObject({ exitCode: 0 });
  const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
  const rectangles: number[][] = [];
  let at = 13 + 3 * (1 << ((output[10]! & 7) + 1));
  while (output[at] !== 59) {
    const marker = output[at++];
    if (marker === 33) at++;
    else {
      expect(marker).toBe(44);
      rectangles.push([0, 2, 4, 6].map(offset => output[at + offset]! | (output[at + offset + 1]! << 8)));
      const flags = output[at + 8]!;
      at += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1;
    }
    while (output[at]) at += output[at]! + 1;
    at++;
  }
  expect(rectangles).toEqual(optimize
    ? [[0, 0, 3, 3], [1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 1, 1]]
    : Array.from({ length: 4 }, () => [0, 0, 3, 3]));
  expect(decodeImage(output, { animated: true }).delay).toEqual([100, 200, 300, 400]);
  const actual = decodeImage(output, { animated: true }).data;
  const expected = decodeImage(input, { animated: true }).data;
  // Hidden RGB may change during palette conversion without changing playback.
  for (const pixels of [actual, expected]) for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) pixels.fill(0, i, i + 3);
  }
  expect(actual).toEqual(expected);
});
