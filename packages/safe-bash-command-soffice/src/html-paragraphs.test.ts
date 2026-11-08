import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand } from "./index.js";

const cases = [
  { fixture: "typography", expected: "Typography\nAV WA fi ffi — café naïve Ελληνικά العربية हिन्दी\nBold Italic 24 CSS px\nNarrow justified text tests line wrapping, word spacing and glyph widths.\n" },
  { fixture: "links", expected: "Links\nInternal multiline link with enough words to wrap onto another line\nAbsent target External\nDestination\nBack\n" },
  { fixture: "long-table", expected: "Row\tDescription\n" + Array.from({ length: 80 }, (_, i) => `${String(i + 1).padStart(3, "0")}\tRepeated cell with wrapping text and a visible baseline marker.\n`).join("") }
];

for (const { fixture, expected } of cases) for (const extension of ["html", "htm"]) {
  test(`public HTML-to-TXT paragraph and row separation: ${fixture}.${extension}`, async () => {
    const fs = new MemoryFileSystem();
    const input = await readFile(new URL(`../../safe-bash-command-wkhtmltopdf/fixtures/qualification/${fixture}.html`, import.meta.url));
    await fs.writeFile(`/input.${extension}`, input);
    let stderr = "";
    const result = await createSofficeCommand().execute({
      command: "soffice", cwd: "/", env: {}, fs,
      ...createCommandArguments(["--headless", "--convert-to", "txt:Text", "--outdir", "/out", `/input.${extension}`]),
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/out/input.txt")), expected);
  });
}
