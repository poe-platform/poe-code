import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftotextCommand, extractPdfToTextBytes } from "./index.js";

const fixture = readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-pattern_text_embedded_font.pdf", import.meta.url));
const cases: { name: string; bytes: Uint8Array; flags: string[]; expected: string }[] = [
  { name: "adjacent pattern text", bytes: fixture, flags: [], expected: "AbCdEf\nAbCdEf\n\n\f" },
  { name: "adjacent pattern text without page breaks", bytes: fixture, flags: ["-nopgbrk"], expected: "AbCdEf\nAbCdEf\n\n" },
  { name: "pattern text layout", bytes: fixture, flags: ["-layout"], expected: "AbCdEf\nAbCdEf\n\f" },
];
for (const [size, gap] of [[20, 24], [24, 24], [20, 60]]) {
  const doc = PdfDocument.create();
  const page = doc.addPage();
  page.drawText("First", { x: 20, y: 200, size: 20 });
  page.drawText("Second", { x: 20, y: 200 - gap!, size: size! });
  cases.push({ name: `heading size ${size}, gap ${gap}`, bytes: doc.save(), flags: [], expected: `First${size === 20 && gap === 24 ? "\n" : "\n\n"}Second\n\n\f` });
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
