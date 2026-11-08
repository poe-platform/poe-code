import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { decodePng } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftoppmCommand, runPdftoppmCli } from "./index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
for (const quiet of [false, true]) it.each([false, true])(`renders invalid PostScript shading like Poppler (quiet=${quiet}, retained=%s)`, async retained => {
  const input = fixture("pdfjs-function_based_shading.pdf");
  const argv = ["-f", "1", "-l", "1", "-r", "24", "-png", "-singlefile", "in.pdf", "out"];
  if (quiet) argv.unshift("-q");
  let output: Uint8Array;
  let stderr = "";
  if (retained) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    await fs.writeFile("/in.pdf", input);
    const args = createCommandArguments(argv);
    const result = await createPdftoppmCommand().execute({ command: "pdftoppm", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } } });
    expect(result.exitCode).toBe(0);
    output = await fs.readFile("/out.png");
  } else {
    const files = new Map([["in.pdf", input]]);
    const result = await runPdftoppmCli(argv, files);
    expect(result.exitCode).toBe(0);
    stderr = result.stderr;
    output = files.get("out.png")!;
  }
  const actual = decodePng(output), expected = decodePng(fixture("pdfjs-function-based-shading-poppler.png"));
  expect([actual.width, actual.height]).toEqual([204, 264]);
  // Poppler 26.09.0, -f 1 -l 1 -r 24 -png -singlefile. Compare the
  // entire invalid tile interior; edges use different antialiasing rules.
  for (let y = 148; y < 203; y++) {
    const start = (y * actual.width + 11) * 4;
    expect(actual.data.slice(start, start + 55 * 4)).toEqual(expected.data.slice(start, start + 55 * 4));
  }
  expect(stderr).toBe(quiet ? "" : "Syntax Error: Type mismatch in PostScript function\n");
  // Valid neighboring tiles still render, including those after the bad one.
  for (const [x, y] of [[20, 30], [90, 30], [160, 30], [20, 120], [90, 120], [160, 120], [90, 180], [160, 180]]) {
    const at = (y! * actual.width + x!) * 4;
    for (let c = 0; c < 3; c++) expect(Math.abs(actual.data[at + c]! - expected.data[at + c]!)).toBeLessThanOrEqual(16);
  }
});
