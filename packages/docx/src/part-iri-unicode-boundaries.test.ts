import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, normalizePartName, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const values = [[0xdfffd, true], [0xdfffe, false], [0xe0000, false], [0xe0001, false],
  [0xe0fff, false], [0xe1000, true], [0xefffd, true], [0xefffe, false], [0xf0000, false]] as const;
const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const route of ["uri", "model", "sdk", "shell"])
it.each(values)(`${route} validates literal part IRI code point %i; ${kind} strict=${strict}`, async (point, valid) => {
  const name = "word/coast-" + String.fromCodePoint(point) + ".xml";
  const memory = Volume.fromJSON({ "/name": name, "/input": "", "/output": "" });
  if (route === "uri") {
    const input = memory.readFileSync("/name", "utf8") as string;
    if (valid) expect(normalizePartName("/" + input)).toBe("/" + name);
    else expect(() => normalizePartName("/" + input)).toThrowError(expect.objectContaining({ code: "invalid-package" }));
    expect(memory.readFileSync("/name", "utf8")).toBe(name);
    return;
  }
  const parts = new Map([...readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict))].map(([key, bytes]) => {
    let text = new TextDecoder().decode(bytes);
    if (key === "[Content_Types].xml" || key === "_rels/.rels") text = text.replaceAll("word/document.xml", name);
    if (kind === "dotx" && key === "[Content_Types].xml") text = text.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
    return [key === "word/document.xml" ? name : key === "word/_rels/document.xml.rels" ? "word/_rels/" + name.slice(5) + ".rels" : key, enc(text)] as const;
  }));
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {
    if (!valid) await expect(Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    else {
      const doc = await Document(input, textContext); expect(String(doc.part.partname)).toBe("/" + name);
      doc.paragraphs[0]!.text = "Revised coast";
      await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
      const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
      expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Revised coast");
      for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part)).toEqual(bytes);
    }
  } else if (route === "sdk") {
    const result = inspectDocument(input, textContext);
    if (!valid) await expect(result).rejects.toMatchObject({ code: "invalid-package" });
    else expect((await result).parts.map(part => part.name)).toContain("/" + name);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retain"));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx inspect /input --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 1);
    if (!valid) expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
    else expect(JSON.parse(result.stdout).data.parts.map((part: { name: string }) => part.name)).toContain("/" + name);
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retain"));
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
