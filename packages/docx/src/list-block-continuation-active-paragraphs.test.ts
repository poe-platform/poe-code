import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
function nodes(root: Node): Node[] {
  const result: Node[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node);
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!;
      if (typeof child !== "string") pending.push(child);
    }
  }
  return result;
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const container of ["body", "cell"] as const) for (const explicitStart of [false, true])
for (const level of [0, 1]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`${route} block list continuation uses active ${carrier} paragraph; ${container}; start=${explicitStart ? 1 : "omitted"}; level=${level}; ${kind}; strict=${strict}`, async () => {
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const selected = '<w:p><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Selected 日本 עברית é 🌊</w:t></w:r><!--selected--><?policy keep?></w:p>';
  const inert = '<f:opaque f:stamp="inert">Stored alternative</f:opaque>';
  const active = carrier === "direct" ? selected + inert : carrier === "process" ? `<f:pass f:stamp="carrier">${selected}</f:pass>${inert}` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : inert}</mc:Fallback></mc:AlternateContent>`;
  const content = '<w:p><w:r><w:t>Retained</w:t></w:r></w:p>' + active;
  const body = container === "body" ? content : `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>`;
  const definition = `<w:abstractNum w:abstractNumId="4">${[0, 1].map(index => `<w:lvl w:ilvl="${index}"><w:start w:val="${index + 3}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${index + 1})"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum>`;
  const original = readPackage(await textFixture("", { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}">${definition}<w:num w:numId="7"><w:abstractNumId w:val="4"/></w:num><!--numbering--><?numbering keep?></w:numbering>` } }, strict));
  original.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${ns}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:list-continuation" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:body>${body}<w:sectPr/></w:body></w:document>`));
  if (kind === "dotx") original.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(original.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...original].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const args = { ...(container === "cell" ? { table: 1, cell: "A1" } : {}), kind: "decimal" as const, text: "Continued", ...(level === 1 ? { level } : {}), ...(explicitStart ? { start: 1 } : {}) };
  const batch = { version: 1, operations: [{ operation: "lists.add", arguments: args }] };
  const pub = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") expect((await api.editDocumentLists(input, { operation: "lists.add", options: { ...args, output: "-" } }, pub)).changes).toHaveLength(1);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, pub);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify(batch)}'` : `docx lists add /input ${container === "cell" ? "--table 1 --cell A1" : ""} --kind decimal --text Continued${level === 1 ? " --level 1" : ""}${explicitStart ? " --start 1" : ""}`;
      const result = await shell.exec(command + " --output /out --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).affected).toBe(1);
      expect(await fs.readFile("/input")).toEqual(input);
      memory.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output);
  assertPackageLinks(saved); expect([...saved.keys()]).toEqual([...original.keys()]);
  for (const [name, bytes] of original) if (name !== "word/document.xml" && (!explicitStart || name !== "word/numbering.xml")) expect(saved.get(name), name).toEqual(bytes);
  const story = new TextDecoder().decode(saved.get("word/document.xml"));
  expect(story).toContain(active); expect(story).toContain('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>'); expect(story).toContain("<w:sectPr/>");
  const d = await api.Document(output, textContext), paragraphs = container === "body" ? d.paragraphs : d.tables[0]!.cell(0, 0).paragraphs;
  expect(paragraphs.map(p => p.text)).toEqual(["Retained", "Selected 日本 עברית é 🌊", "Continued"]);
  expect(paragraphs[1]!.runs[0]!.italic).toBe(true); expect(paragraphs[1]!.runs[0]!.font.rtl).toBe(true); expect(paragraphs[1]!.paragraph_format.keep_with_next).toBe(true);
  const all = nodes(xmlStructure(saved.get("word/document.xml")!));
  const added = all.find(n => n.name === `{${ns}}p` && nodes(n).some(t => t.name === `{${ns}}t` && t.children.includes("Continued")))!;
  const properties = nodes(added), id = properties.find(n => n.name === `{${ns}}numId`)!.attributes[`{${ns}}val`];
  expect(properties.find(n => n.name === `{${ns}}ilvl`)!.attributes[`{${ns}}val`]).toBe(String(level));
  if (!explicitStart) expect(id).toBe("7");
  else {
    expect(id).not.toBe("7");
    const numbering = nodes(xmlStructure(saved.get("word/numbering.xml")!)), nums = numbering.filter(n => n.name === `{${ns}}num`);
    expect(nums).toHaveLength(2);
    const addedNum = nums.find(n => n.attributes[`{${ns}}numId`] === id)!;
    const abstractId = nodes(addedNum).find(n => n.name === `{${ns}}abstractNumId`)!.attributes[`{${ns}}val`];
    const abstract = numbering.find(n => n.name === `{${ns}}abstractNum` && n.attributes[`{${ns}}abstractNumId`] === abstractId)!;
    const target = nodes(abstract).find(n => n.name === `{${ns}}lvl` && n.attributes[`{${ns}}ilvl`] === String(level))!;
    expect(nodes(target).find(n => n.name === `{${ns}}start`)!.attributes[`{${ns}}val`]).toBe("1");
    expect(new TextDecoder().decode(saved.get("word/numbering.xml"))).toContain(definition);
  }
  expect((await api.validateDocument(output, textContext)).valid).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
