import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const shape of ["ignored-property", "processed-property", "fallback-property", "run-attribute"] as const)
for (const placement of ["selected-middle", "selected-last", "following-unselected", "preceding-unselected"] as const)
for (const remaining of [0, 1, "default"] as const)
for (const route of ["model", "model-sdk-batch", "model-cli-batch", "sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`later opaque comment anchor ownership; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; shape=${shape}; placement=${placement}; remaining=${remaining}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const properties = shape === "ignored-property" ? '<w:rPr><w:i/><o:leaf/></w:rPr>'
    : shape === "processed-property" ? '<w:rPr><o:carrier><w:i/></o:carrier></w:rPr>'
    : shape === "fallback-property" ? '<w:rPr><mc:AlternateContent><mc:Choice Requires="o"><o:leaf/></mc:Choice><mc:Fallback><w:i/></mc:Fallback></mc:AlternateContent></w:rPr>' : "";
  const opaqueIndex = placement === "selected-middle" ? 1 : placement === "preceding-unselected" ? 0 : 3;
  const runMarkup = [0, 1, 2, 3].map(index => `<w:r${index === opaqueIndex && shape === "run-attribute" ? ' o:stored="Retained海🌊"' : ""}>${index === opaqueIndex ? properties : ""}<w:t>${["A海", "B🌊", "C", "D"][index]}</w:t></w:r>`);
  const input = await encodeWholeXmlFixture(await textFixture(`<w:p xmlns:o="urn:original:later-opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o" mc:ProcessContent="o:carrier">${runMarkup.join("")}</w:p><!--retained--><?audit exact?>`, {}, strict, { kind }), codec);
  const original = input.slice(), originals = readPackage(input);
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const index = placement === "preceding-unselected" ? 3 : 0;
  const whole = placement === "selected-middle" || placement === "selected-last";
  const locations = await api.openDocumentLocations(input, context), paragraph = locations.at("paragraph", 1);
  expect(locations.text({ select: paragraph.token }).text).toBe("A海B🌊CD");
  const select = locations.range(paragraph.token, index === 3 ? 5 : 0, whole ? 6 : index === 3 ? 6 : 2).token;
  const args = { select, author: "", timestamp: "2026-03-04T05:06:07Z", text: "Coastal observation" };
  const model = route === "model" || route === "model-sdk-batch" || route === "model-cli-batch";
  const operations = model ? [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: whole ? ref("runs") : ref("runs", index), text: "Coastal observation", author: "" } }
  ] : [{ operation: "comments.add" as const, arguments: args }];
  const memory = Volume.fromJSON({ "/output": "" }), retained = new TextEncoder().encode("Retained destination");
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const unaffected = placement === "preceding-unselected" || model && placement === "following-unselected";
  const code = !unaffected ? "unsupported-edit" : remaining === "default" ? null : "limit-exceeded";
  if (route === "model") {
    const budget = new api.DocumentBudget(), document = await api.Document(input, { ...context, budget });
    const runs = document.paragraphs[0]!.runs, selected = whole ? runs : runs[index]!;
    const before = document.part.package.parts.map(part => [String(part.partname), part.blob]);
    if (remaining !== "default") budget.charge("insertedNodes", budget.limits.insertedNodes - budget.usage.insertedNodes - remaining);
    if (code) {
      expect(() => document.add_comment(selected, "Coastal observation", "")).toThrowError(expect.objectContaining({ code }));
      expect(document.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
      await document.save(sink);
      expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(original);
      memory.writeFileSync("/output", "");
    } else { expect(document.add_comment(selected, "Coastal observation", "").comment_id).toBe(0); await document.save(sink); }
  } else if (route === "sdk" || route === "sdk-batch" || route === "model-sdk-batch") {
    const publication = { ...context, ...(remaining === "default" ? {} : { budget: new api.DocumentBudget({ insertedNodes: remaining }) }), stdout: sink };
    const pending = route === "sdk" ? api.editDocumentComments(input, { operation: "comments.add", options: { ...args, output: "-" } }, publication) : api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", ...(model ? { timestamp: args.timestamp } : {}) }, publication);
    if (code) { await expect(pending).rejects.toMatchObject({ code, ...(route !== "sdk" ? { operationIndex: model ? 2 : 0 } : {}) }); expect(memory.statSync("/output").size).toBe(0); }
    else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", retained);
    await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx comments add /input --select '${select}' --author '' --timestamp 2026-03-04T05:06:07Z --text 'Coastal observation'` : "docx batch /input --ops-file /operations" + (model ? " --timestamp 2026-03-04T05:06:07Z" : "");
      const result = await shell.exec(command + " --output /destination --force --json" + (remaining === "default" ? "" : ` --limit insertedNodes=${remaining}`));
      expect(result.exitCode, result.stdout + result.stderr).toBe(code === "limit-exceeded" ? 4 : code ? 1 : 0);
      if (code) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code, ...(route !== "cli" ? { operationIndex: model ? 2 : 0 } : {}) }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: true }); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  if (code) expect(memory.statSync("/output").size).toBe(0);
  else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    expect((await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context)).items[0]).toMatchObject({ comment_id: 0, author: "", text: "Coastal observation", issues: [] });
    const editor = new api.DocumentXmlEditor(saved.get("word/document.xml")!), p = editor.root.children[0]!.children[0]!;
    expect(p.children.filter(node => node.localName === "r" && !node.children.some(child => child.localName === "commentReference")).map(node => editor.sourceXml(node))).toEqual(runMarkup);
    for (const [part, bytes] of originals) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  }
  expect(input).toEqual(original);
});
