import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const token of ["true", "false", "1", "0"]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`extracts stored XML boolean whitespace consistently with native direct properties; ${token}; ${route}; ${kind}; strict=${strict}`, async () => {
  const lexical = ` &#x9;${token}&#xD;&#xA; `, expected = token === "true" || token === "1";
  const text = "עברית \u2067日本\u2069 e\u0323\u0301 🌊 𠀀";
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
    `<w:p><w:pPr><w:bidi w:val="${lexical}"/></w:pPr><w:r><w:rPr>${["b", "i", "rtl", "vanish"].map(tag => `<w:${tag} w:val="${lexical}"/>`).join("")}</w:rPr><w:t>${text}</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const original = input.slice(), members = readPackage(input), memory = Volume.fromJSON({ "/destination": "Retained destination" });
  const native = await api.Document(input, textContext), run = native.paragraphs[0]!.runs[0]!;
  expect([run.bold, run.italic, run.font.rtl, run.font.hidden]).toEqual(Array(4).fill(expected));
  expect(native.paragraphs[0]!.text).toBe(text);
  const batch = { version: 1, operations: [{ operation: "text.get", arguments: {} }] };
  let data: api.TextData;
  if (route === "sdk") data = await api.extractDocumentText(input, textContext);
  else if (route === "sdk-batch") {
    const result = await api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write() { throw new Error("Read wrote output"); } } });
    expect(result.publication).toBeNull(); expect(result.results[0]!.affected).toBe(0);
    data = result.results[0]!.data as api.TextData;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? "docx text /input --json" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`;
      const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(0);
      data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(data.text).toBe(text); expect(data.hiddenText).toBe("include");
  expect(data.segments).toHaveLength(1);
  expect(data.segments[0]!.formatting).toMatchObject({ bold: expected, italic: expected, rtl: expected, hidden: expected, paragraph: { bidi: expected } });
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(members);
  expect(memory.readFileSync("/destination").toString()).toBe("Retained destination");
});
