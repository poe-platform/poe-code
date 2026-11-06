import { readFileSync } from "node:fs";
import { decode as decodeJpeg } from "jpeg-js";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftoppmCommand, runPdftoppmCli } from "./index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
it.each([false, true])("renders CMYK JPEG colors like Poppler (retained=%s)", async retained => {
  const input = fixture("pdfjs-cmykjpeg.pdf");
  const argv = ["-f", "1", "-l", "1", "-r", "24", "-png", "-singlefile", "in.pdf", "out"];
  let output: Uint8Array;
  if (retained) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    await fs.writeFile("/in.pdf", input);
    const args = createCommandArguments(argv);
    const result = await createPdftoppmCommand().execute({ command: "pdftoppm", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async () => {} } });
    expect(result.exitCode).toBe(0);
    output = await fs.readFile("/out.png");
  } else {
    const files = new Map([["in.pdf", input]]);
    expect((await runPdftoppmCli(argv, files)).exitCode).toBe(0);
    output = files.get("out.png")!;
  }
  const actual = decodePng(output), expected = decodePng(fixture("pdfjs-cmykjpeg-poppler-page.png"));
  expect([actual.width, actual.height]).toEqual([204, 264]);
  const offset = (9 * actual.width + 9) * 4;
  for (let i = offset; i < offset + 4; i++) expect(Math.abs(actual.data[i]! - expected.data[i]!)).toBeLessThanOrEqual(1);
  // Page resampling differs from Splash; compare colors in the reported flat
  // patch above, while bounding the aggregate error over the complete page.
  let total = 0;
  for (let i = 0; i < actual.data.length; i++) total += Math.abs(actual.data[i]! - expected.data[i]!);
  expect(total / actual.data.length).toBeLessThan(0.4);
});

for (const sample of ["fixture", "swatches"]) it.each([false, true])(`emits four-component CMYK JPEG for ${sample} (retained=%s)`, async retained => {
  const colors = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [64, 128, 192]] as const;
  const doc = PdfDocument.create();
  const page = doc.addPage([288, 48]);
  colors.forEach(([r, g, b], i) => page.drawRect({ x: i * 48, y: 0, width: 48, height: 48, fill: { r: r / 255, g: g / 255, b: b / 255 } }));
  const input = sample === "fixture" ? fixture("pdfjs-cmykjpeg.pdf") : doc.save();
  const argv = ["-f", "1", "-l", "1", "-r", "24", "-jpegcmyk", "-jpegopt", "quality=100", "-singlefile", "in.pdf", "out"];
  let output: Uint8Array;
  if (retained) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    await fs.writeFile("/in.pdf", input);
    const args = createCommandArguments(argv);
    const result = await createPdftoppmCommand().execute({ command: "pdftoppm", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async () => {} } });
    expect(result.exitCode).toBe(0);
    output = await fs.readFile("/out.jpg");
  } else {
    const files = new Map([["in.pdf", input]]);
    expect((await runPdftoppmCli(argv, files)).exitCode).toBe(0);
    output = files.get("out.jpg")!;
  }
  const markers = new Map<number, Uint8Array>();
  for (let at = 2; at < output.length;) {
    const marker = output[at + 1]!;
    const length = output[at + 2]! * 256 + output[at + 3]!;
    markers.set(marker, output.subarray(at + 4, at + 2 + length));
    if (marker === 0xda) break;
    at += 2 + length;
  }
  expect(markers.get(0xc0)?.[5]).toBe(4);
  // Adobe transform 0 identifies inverted CMYK, rather than YCCK.
  expect(Array.from(markers.get(0xee) ?? [])).toEqual([65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 0]);
  const actual = decodeJpeg(output);
  expect([actual.width, actual.height]).toEqual(sample === "fixture" ? [204, 264] : [96, 16]);
  if (sample === "swatches") colors.forEach((color, x) => {
    const offset = (8 * actual.width + x * 16 + 8) * 4;
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual.data[offset + channel]! - color[channel]!)).toBeLessThanOrEqual(2);
  });
});
