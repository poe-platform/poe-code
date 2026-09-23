import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLists, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { fidelityBytes, type FidelityEncoding } from "../tests/fixtures/xml-fidelity.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const encodings: FidelityEncoding[] = ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"];
const encode = (text: string) => new TextEncoder().encode(text);
const encodingName = (encoding: FidelityEncoding) => encoding === "UTF-8-BOM" ? "UTF-8" : encoding;
type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const bodyEncoding of encodings) for (const numberingEncoding of encodings) for (const route of ["sdk", "shell"] as const) for (const action of ["restart", "new-instance"] as const) it(`${route} ${action} preserves body ${bodyEncoding} and numbering ${numberingEncoding}; ${kind} strict=${strict}`, async () => {
  const content = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Survey 海 🧭</w:t></w:r></w:p>';
  const opaque = '<f:record f:stamp="retained"> e&#x301; <![CDATA[opaque <&>]]> </f:record>';
  const numbering = `<w:numbering xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:encoding" mc:Ignorable="f"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${opaque}</w:numbering>`;
  const parts = readPackage(await textFixture(content, { numbering: { kind: "numbering", xml: numbering } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const sources = new Map<string, string>();
  for (const [name, encoding] of [["word/document.xml", bodyEncoding], ["word/numbering.xml", numberingEncoding]] as const) {
    const source = `<?xml version="1.0" encoding="${encodingName(encoding)}"?>\r\n<!--prolog--><?audit before?>` + new TextDecoder().decode(parts.get(name)) + '<!--epilog--><?audit after?>';
    sources.set(name, source); parts.set(name, fidelityBytes(source, encoding));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await Document(input, textContext)).paragraphs[0]!.text).toBe("Survey 海 🧭");
  if (route === "sdk") {
    await editDocumentLists(input, action === "restart" ? { operation: "lists.set", options: { paragraph: 1, restart: true, start: 0, output: "-" } } : { operation: "lists.add", options: { paragraph: 1, kind: "bullet", text: "New 海", start: 0, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec(`docx lists ${action === "restart" ? 'set /input --paragraph 1 --restart true --start 0' : "add /input --paragraph 1 --kind bullet --text 'New 海' --start 0"} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output", await fs.readFile("/output"));
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), decodedParts = new Map(after);
  for (const [name, bytes] of parts) if (!sources.has(name)) expect(after.get(name), name).toEqual(bytes);
  for (const [name, encoding] of [["word/document.xml", bodyEncoding], ["word/numbering.xml", numberingEncoding]] as const) {
    const bytes = after.get(name)!, prefix = encoding === "UTF-8" ? 0 : encoding === "UTF-8-BOM" ? 3 : 2;
    expect(bytes.subarray(0, prefix)).toEqual(parts.get(name)!.subarray(0, prefix));
    const decoded = new TextDecoder(encodingName(encoding), { fatal: true }).decode(bytes);
    decodedParts.set(name, encode(decoded));
    expect(decoded.startsWith(`<?xml version="1.0" encoding="${encodingName(encoding)}"?>\r\n<!--prolog--><?audit before?>`)).toBe(true);
    expect(decoded.endsWith('<!--epilog--><?audit after?>')).toBe(true);
    if (name === "word/numbering.xml") {
      expect(decoded).toContain(opaque);
      const before = elements(xmlStructure(encode(sources.get(name)!))).find(n => n.name.endsWith('}numbering'))!, saved = elements(xmlStructure(encode(decoded))).find(n => n.name.endsWith('}numbering'))!;
      for (const child of before.children) expect(saved.children).toContainEqual(child);
      const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
      const added = elements(saved).filter(n => n.name === `{${ns}}num`).at(-1)!;
      expect(added.attributes[`{${ns}}numId`]).toBe("2");
      const override = elements(added).find(n => n.name === `{${ns}}lvlOverride`)!;
      expect(elements(override)[0]!.attributes[`{${ns}}val`]).toBe("0");
    }
  }
  assertPackageLinks(decodedParts);
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(action === "restart" ? ["Survey 海 🧭"] : ["Survey 海 🧭", "New 海"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
