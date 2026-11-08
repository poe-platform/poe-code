import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { decodePng } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftoppmCommand, runPdftoppmCli } from "./index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
for (const page of [1, 2, 3]) it.each([false, true])(`renders CalGray page ${page} like Poppler (retained=%s)`, async retained => {
  const input = fixture("pdfjs-calgray.pdf");
  const argv = ["-f", String(page), "-l", String(page), "-r", "24", "-png", "-singlefile", "in.pdf", "out"];
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
  const actual = decodePng(output), expected = decodePng(fixture(`pdfjs-calgray-poppler-page${page === 1 ? "" : page}.png`));
  expect([actual.width, actual.height]).toEqual([284, 367]);
  // Poppler 26.09.0: pdftoppm -f 1 -l 1 -r 24 -png -singlefile
  // pdfjs-calgray.pdf pdfjs-calgray-poppler-page
  // Sample inside all 20 labeled rectangles, away from text and edges.
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 4; column++) {
      const x = Math.floor((100 + column * 200) / 3);
      const y = Math.floor((1100 - (150 + row * 200)) / 3);
      const offset = (y * actual.width + x) * 4;
      expect(Array.from(actual.data.slice(offset, offset + 4))).toEqual(Array.from(expected.data.slice(offset, offset + 4)));
    }
  }
});
