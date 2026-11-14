import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftoppmCommand, createPdftocairoCommand, runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync } from "./index.js";

// qpdf 12.4.2 accepts this without warnings; PDFium renders solid red.
// A trailing unindexed stream paints green and must not replace the page.
const prefixed = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-header-prefix.pdf", import.meta.url)));
const inputs = [prefixed.subarray("leading bytes\n".length), prefixed];
function red(bytes: Uint8Array) {
  const png = decodePng(bytes);
  expect([png.width, png.height]).toEqual([120, 80]);
  expect(png.data).toEqual(Uint8Array.from({ length: 120 * 80 * 4 }, (_, i) => i % 4 === 0 || i % 4 === 3 ? 255 : 0));
}

for (const run of [runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync]) {
  it(`${run.name} respects indexed content with a header prefix from files and stdin`, async () => {
    for (const bytes of inputs) for (const input of ["input.pdf", "-"]) {
      const files = new Map([[input, bytes]]);
      const result = await run(["-png", "-r", "72", "-singlefile", input, "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      red(files.get("page.png")!);
      expect(files.get(input)).toEqual(bytes);
    }
  });
}

for (const command of [createPdftoppmCommand(), createPdftocairoCommand()]) {
  it(`${command.name} accepts prefixed input and preserves output on malformed input`, async () => {
    const fs = createMemoryFileSystem();
    for (const bytes of [...inputs, new TextEncoder().encode("leading bytes\n%PDF-1.4\nnot a document\n%%EOF\n"), new TextEncoder().encode("not a PDF")]) {
      const valid = inputs.includes(bytes);
      for (const input of ["/input.pdf", "-"]) {
        await fs.writeFile("/input.pdf", bytes);
        await fs.writeFile("/page.png", new Uint8Array([1, 2, 3]));
        const args = createCommandArguments(["-q", "-png", "-r", "72", "-singlefile", input, "/page"]);
        let stderr = "";
        const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
          stdin: (async function* () { if (input === "-") yield bytes; })(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } } });
        expect(result.exitCode).toBe(valid ? 0 : 1);
        expect(stderr).toBe("");
        if (valid) red(await fs.readFile("/page.png"));
        else expect(await fs.readFile("/page.png")).toEqual(new Uint8Array([1, 2, 3]));
        expect(await fs.readFile("/input.pdf")).toEqual(bytes);
      }
    }
  });
}
