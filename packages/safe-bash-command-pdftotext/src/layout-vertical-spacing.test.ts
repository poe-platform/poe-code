import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftotextCommand, extractPdfToTextBytes } from "./index.js";

const fixture = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-form-xobjects-no-resources.pdf", import.meta.url));
const cases: { name: string; bytes: Uint8Array; flags: string[]; expected: string }[] = [
  { name: "form XObject vertical gaps", bytes: fixture, flags: ["-layout"], expected: "Page\n\n\n\n\nFX1\n\n\n\n\nFX2\n\f" },
  { name: "ordinary extraction", bytes: fixture, flags: [], expected: "Page\n\nFX1\n\nFX2\n\n\f" },
];
for (const [gap, returns] of [[19, 1], [20, 2], [29, 2], [100, 5]]) {
  const doc = PdfDocument.create();
  const page = doc.addPage();
  page.drawText("First", { x: 20, y: 200, size: 10 });
  page.drawText("Second", { x: 20, y: 200 - gap!, size: 20 });
  cases.push({ name: `gap ${gap} uses preceding font size and caps returns`, bytes: doc.save(), flags: ["-layout"], expected: `First${"\n".repeat(returns!)}Second\n\f` });
}
for (const { name, bytes, flags, expected } of cases) it(name, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.pdf", bytes);
  const args = createCommandArguments([...flags, "/input.pdf", "-"]);
  const chunks: Uint8Array[] = [];
  const result = await createPdftotextCommand().execute({
    command: "pdftotext", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), expected);
  assert.deepEqual(await fs.readdir("/scratch"), []);
  const direct = extractPdfToTextBytes(bytes, flags);
  assert.equal(direct.exitCode, 0);
  assert.equal(direct.output, expected);
});
