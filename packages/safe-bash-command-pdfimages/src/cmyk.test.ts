import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { decodePng } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdfimagesCommand, runPdfimagesCli } from "./index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
it.each([false, true])("matches Poppler CMYK JPEG extraction (retained=%s)", async retained => {
  const input = fixture("pdfjs-cmykjpeg.pdf");
  const argv = ["-png", "in.pdf", "out"];
  let output: Uint8Array;
  if (retained) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    await fs.writeFile("/in.pdf", input);
    const args = createCommandArguments(argv);
    const result = await createPdfimagesCommand().execute({ command: "pdfimages", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async () => {} } });
    expect(result.exitCode).toBe(0);
    output = await fs.readFile("/out-000.png");
  } else {
    const files = new Map([["in.pdf", input]]);
    expect((await runPdfimagesCli(argv, files)).exitCode).toBe(0);
    output = files.get("out-000.png")!;
  }
  const actual = decodePng(output), expected = decodePng(fixture("pdfjs-cmykjpeg-poppler.png"));
  expect([actual.width, actual.height]).toEqual([200, 150]);
  expect(Array.from(actual.data.slice(0, 4))).toEqual(Array.from(expected.data.slice(0, 4)));
  // Independent JPEG IDCTs can differ by a sample; reject profile/sampling shifts.
  const errors = actual.data.map((value, i) => Math.abs(value - expected.data[i]!));
  expect(Math.max(...errors)).toBeLessThanOrEqual(2);
  expect(errors.reduce((sum, value) => sum + value, 0) / errors.length).toBeLessThan(0.1);
});
