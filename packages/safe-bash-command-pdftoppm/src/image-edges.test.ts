import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { createPdftoppmCommand } from "./index.js";

// Bounds measured with Poppler pdftoppm for the same in-memory PDF.
test.each([
  { flags: ["-r", "72"], size: [612, 792], bounds: [25, 92, 225, 192] },
  { flags: ["-scale-to", "256"], size: [198, 256], bounds: [8, 29, 72, 62] },
  { flags: ["-r", "90"], size: [765, 990], bounds: [31, 115, 281, 240] },
])("paints inclusive image edges with $flags", async ({ flags, size, bounds }) => {
  const doc = PdfDocument.create();
  doc.addPage([612, 792]).drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])),
    { x: 25, y: 600, width: 200, height: 100 });
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.pdf", doc.save());
  const argumentValues = createCommandArguments(["-f", "1", "-l", "1", "-singlefile", "-png", ...flags, "/in.pdf", "/out"]);
  const stderr: Uint8Array[] = [];
  const result = await createPdftoppmCommand().execute({
    command: "pdftoppm", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toEqual([]);
  const image = decodePng(await fs.readFile("/out.png"));
  expect([image.width, image.height]).toEqual(size);
  const [left, top, right, bottom] = bounds as [number, number, number, number];
  const pixel = (x: number, y: number) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
  const middleX = Math.floor((left + right) / 2), middleY = Math.floor((top + bottom) / 2);
  for (const x of [left, middleX, right]) for (const y of [top, middleY, bottom]) {
    expect(pixel(x, y), `pixel ${x},${y}`).toEqual([255, 0, 0, 255]);
  }
  for (const [x, y] of [[left - 1, middleY], [right + 1, middleY], [middleX, top - 1], [middleX, bottom + 1]]) {
    expect(pixel(x!, y!)).toEqual([255, 255, 255, 255]);
  }
});
