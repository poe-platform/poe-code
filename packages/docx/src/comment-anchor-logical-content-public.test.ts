import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const samples = [
  { name: "self-closing-empty-text", xml: "<w:r><w:t/></w:r>", text: "", accepted: false },
  { name: "paired-empty-text", xml: "<w:r><w:t></w:t></w:r>", text: "", accepted: false },
  { name: "two-empty-text-runs", xml: "<w:r><w:t/></w:r><w:r><w:t/></w:r>", text: "", accepted: false },
  { name: "properties-only-run", xml: "<w:r><w:rPr><w:i/></w:rPr></w:r>", text: "", accepted: false },
  { name: "preserved-space", xml: '<w:r><w:t xml:space="preserve"> </w:t></w:r>', text: " ", accepted: true },
  { name: "tab", xml: "<w:r><w:tab/></w:r>", text: "\t", accepted: true },
  { name: "positional-tab", xml: '<w:r><w:ptab w:alignment="left" w:relativeTo="indent" w:leader="none"/></w:r>', text: "\t", accepted: true },
  { name: "nonbreaking-hyphen", xml: "<w:r><w:noBreakHyphen/></w:r>", text: "‑", accepted: true },
  { name: "soft-hyphen", xml: "<w:r><w:softHyphen/></w:r>", text: "­", accepted: true },
  { name: "line-break", xml: "<w:r><w:br/></w:r>", text: "\n", accepted: true },
  { name: "carriage-return", xml: "<w:r><w:cr/></w:r>", text: "\n", accepted: true }
] as const;
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "cli"] as const) for (const sample of samples)
it(`comment anchor requires nonempty logical run content; strict=${strict}; kind=${kind}; route=${route}; content=${sample.name}`, async () => {
  const input = await textFixture(`<w:p>${sample.xml}</w:p><!--retained--><?audit exact?>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs"), text: "Added note", author: "" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.comment_id.get", receiver: ref("comment"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, context), before = doc.part.package.parts.map(part => [String(part.partname), part.blob]);
    expect(doc.paragraphs[0]!.text).toBe(sample.text);
    if (sample.accepted) { expect(doc.add_comment(doc.paragraphs[0]!.runs, "Added note", "").comment_id).toBe(0); await doc.save(sink); }
    else { expect(() => doc.add_comment(doc.paragraphs[0]!.runs, "Added note", "")).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); expect(doc.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before); }
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: "2026-03-04T05:06:07Z" }, { ...context, stdout: sink });
    if (sample.accepted) expect((await pending).results.at(-1)!.data).toBe(0);
    else await expect(pending).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 2 });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(sample.accepted ? 0 : 1);
      if (sample.accepted) { expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(0); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      else { expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 2 }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (sample.accepted) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), doc = await api.Document(output, context), before = readPackage(input), after = readPackage(output);
    expect(doc.paragraphs[0]!.text).toBe(sample.text); expect(doc.comments.get(0)!.text).toBe("Added note");
    const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const editor = new api.DocumentXmlEditor(after.get("word/document.xml")!);
    const paragraph = editor.root.children[0]!.children[0]!;
    expect(paragraph.children.filter(node => node.namespace === word && node.localName === "r" && !node.children.some(child => child.localName === "commentReference")).map(node => editor.sourceXml(node)).join("")).toBe(sample.xml);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    const source = new TextDecoder().decode(after.get("word/document.xml")); expect(source).toContain("<!--retained-->"); expect(source).toContain("<?audit exact?>");
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
