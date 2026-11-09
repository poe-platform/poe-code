import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import sharp, {decodeImage} from "./index.js";

for (const ending of ["\r", "\n", "\r\n"]) it.each([
  {header: "P1\n3 1\n", samples: ["1", "0 1"], expected: [0, 255, 0]},
  {header: "P2\n3 1\n15\n", samples: ["1", "5 13"], expected: [17, 85, 221]},
  {header: "P3\n1 1\n15\n", samples: ["1", "5 13"], expected: [17, 85, 221]},
])(`decodes $header raster comments ending in ${JSON.stringify(ending)} in memory and storage`, async ({header, samples, expected}) => {
  const bytes = Buffer.from(`${header}${samples[0]} #note${ending}${samples[1]}\n`);
  const rgba = header.startsWith("P3") ? [...expected, 255] : expected.flatMap(value => [value, value, value, 255]);
  expect(Array.from(decodeImage(bytes).data)).toEqual(rgba);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.pnm", bytes);
  expect(Array.from(await sharp("/input.pnm", {filesystem: fs}).raw().toBuffer())).toEqual(expected);
});
