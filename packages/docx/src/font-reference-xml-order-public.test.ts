import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`font resources retain owner-local XML relationship order; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const initial = await textFixture('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>', { fonts: { kind: "fontTable", xml: `<w:fonts xmlns:w="${w}"/>` } }, strict, { kind });
  const archive = await api.readArchive(initial, textContext), member = archive.members.find(member => member.name === "word/_rels/document.xml.rels")!;
  const editor = new api.DocumentXmlEditor(member.bytes);
  editor.insertChildren(editor.root, '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="z-audit" Type="urn:font:audit" Target="fonts.xml"/><Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="a-audit" Type="urn:font:audit" Target="fonts.xml"/>');
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ ...archive, members: archive.members.map(current => current === member ? { ...current, bytes: editor.serialize() } : current) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), batch = { version: 1 as const, operations: [{ operation: "fonts.list", arguments: {} }] };
  let data: unknown;
  if (route === "sdk") data = await api.inspectDocumentFonts(input, {}, context);
  else if (route === "sdk-batch") data = (await api.executeDocumentBatch(input, batch, { dryRun: true }, context)).results[0]!.data;
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec((route === "cli" ? "docx fonts list /input" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run`) + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); const result = JSON.parse(response.stdout); data = route === "cli" ? result.data : result.data.results[0].data;
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const items = (data as { items: { references: { owner: string; id: string; target: string }[]; details: { parts: { name: string; bytes: number; sha256: string }[] } }[] }).items;
  expect(items).toHaveLength(1);
  expect(items[0]!.references.map(reference => reference.id)).toEqual(["fonts", "z-audit", "a-audit"]);
  expect(items[0]!.references.every(reference => reference.owner === "/word/document.xml" && reference.target === "fonts.xml")).toBe(true);
  expect(items[0]!.details.parts).toEqual([expect.objectContaining({ name: "/word/fonts.xml", bytes: expect.any(Number), sha256: expect.any(String) })]);
  expect(memory.statSync("/output").size).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
