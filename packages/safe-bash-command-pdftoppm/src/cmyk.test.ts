import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { decodePng } from "@poe-code/pdf-ast";
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
