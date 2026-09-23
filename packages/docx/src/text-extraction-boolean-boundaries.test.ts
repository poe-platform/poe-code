import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const field of ["b", "i", "rtl", "vanish", "bidi"]) for (const token of [" on ", " off ", "\u00a0false\u00a0", "\u20030\u2003"])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`rejects malformed selected text formatting boolean without output; ${field}; ${JSON.stringify(token)}; ${route}; ${kind}; strict=${strict}`, async () => {
  const property = `<w:${field} w:val="${token}"/>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
    `<w:p><w:pPr>${field === "bidi" ? property : ""}</w:pPr><w:r><w:rPr>${field === "bidi" ? "" : property}</w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const original = input.slice(), members = readPackage(input), batch = { version: 1, operations: [{ operation: "text.get", arguments: {} }] };
  if (route === "sdk") await expect(api.extractDocumentText(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write() { throw new Error("Rejected read wrote output"); } } })).rejects.toMatchObject({ code: "invalid-package" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? "docx text get /input --json" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`;
      const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "invalid-package" }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(members);
});
