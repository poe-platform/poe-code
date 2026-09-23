import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const timestamp = "2026-03-04T05:06:07Z";
const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const noteKind of ["footnote", "endnote"] as const)
for (const balanced of [false, true])
for (const route of ["utility-sdk", "utility-cli", "model-sdk", "model-cli"] as const)
it(`comment field state stays in its actual note owner; strict=${strict}; kind=${kind}; note=${noteKind}; balanced=${balanced}; route=${route}`, async () => {
  const scope = `${noteKind}s` as "footnotes" | "endnotes";
  const input = await textFixture(`<w:p><w:r><w:t>Retained body</w:t></w:r><w:r><w:${noteKind}Reference w:id="12"/></w:r><w:r><w:${noteKind}Reference w:id="17"/></w:r></w:p>`, {
    notes: { kind: scope, xml: `<w:${scope} xmlns:w="${w}"><w:${noteKind} w:id="12"><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>UNKNOWN inert</w:instrText></w:r><w:r><w:t>Unselected cached field</w:t></w:r>${balanced ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : ""}</w:p></w:${noteKind}><w:${noteKind} w:id="17"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Selected海🌊</w:t></w:r></w:p></w:${noteKind}><!--notes--><?audit notes?></w:${scope}>` }
  }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, timestamp: new Date(timestamp), encoding: { order: "input", compression: "store" } as const };
  const locations = await api.openDocumentLocations(input, context, "inventory"), paragraph = locations.at("paragraph", 2, { scope });
  expect(locations.text({ select: paragraph.token }).text).toBe("Selected海🌊");
  const select = locations.range(paragraph.token, 0, [..."Selected海🌊"].length).token;
  const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const operations = [
    { operation: "paragraphs.get", arguments: { select: paragraph.token }, resultHandle: "paragraph" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraph"), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "Isolated note", author: "" } }
  ];
  const refusalCode = route.startsWith("utility") ? "invalid-package" : "unsupported-edit";
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "utility-sdk" || route === "model-sdk") {
    const pending = route === "utility-sdk" ? api.editDocumentComments(input, { operation: "comments.add", options: { select, text: "Isolated note", author: "", timestamp, output: "-" } }, { ...context, stdout: sink }) : api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp }, { ...context, stdout: sink });
    if (balanced) await pending;
    else await expect(pending).rejects.toMatchObject({ code: refusalCode });
  }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained destination"); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route === "utility-cli" ? `docx comments add /input --select '${select}' --text 'Isolated note' --author '' --timestamp ${timestamp}` : `docx batch /input --ops-file /operations --timestamp ${timestamp}`;
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(await fs.readFile("/input")).toEqual(input);
      if (result.exitCode !== 0) expect(await fs.readFile("/destination")).toEqual(retained);
      expect(result.exitCode, result.stdout + result.stderr).toBe(balanced ? 0 : 1);
      if (balanced) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1, errors: [] }); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      else expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: refusalCode }] });
    } finally { await shell.dispose(); }
  }
  if (!balanced) {
    expect(memory.statSync("/output").size).toBe(0);
    expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    expect((await api.validateDocument(input, context)).valid).toBe(false);
    return;
  }
  const before = readPackage(input), output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect(after.get("word/document.xml")).toEqual(before.get("word/document.xml"));
  for (const [name, bytes] of before) if (!["word/notes.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const prior = new api.DocumentXmlEditor(before.get("word/notes.xml")!), saved = new api.DocumentXmlEditor(after.get("word/notes.xml")!);
  expect(saved.sourceXml(saved.root.children[0]!)).toBe(prior.sourceXml(prior.root.children[0]!));
  expect(saved.sourceXml(saved.root)).toContain("<!--notes--><?audit notes?>");
  const comment = (await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context)).items[0]!;
  expect(comment).toMatchObject({ text: "Isolated note", author: "", issues: [], range: { start: { part: "/word/notes.xml", path: [1, 0, 0] }, end: { part: "/word/notes.xml", path: [1, 0, 2] } } });
  expect((await api.extractDocumentText(output, context, { select: (await api.openDocumentLocations(output, context)).at("paragraph", 2, { scope }).token })).text).toBe("Selected海🌊");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
