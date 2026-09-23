import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "@poe-platform/safe-bash";
import {docxCommands} from "@poe-platform/safe-bash/commands/docx";
import {Document, createDocxInspectionCommandEngine, editDocumentParagraphs, formatDocumentRuns, replaceDocumentXmlPart, writeArchive} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["paragraph", "run"] as const) for (const position of ["before", "after"] as const)
for (const action of ["add", "remove"] as const) for (const route of ["model", "sdk", "shell", "xml-sdk", "xml-shell"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const codec of ["utf8", "utf16be"] as const)
it(`${route} ${action}s native ${owner} flag with retained opaque sibling ${position}; ${kind} strict=${strict}${carrier === "direct" && codec === "utf8" ? "" : ` ${carrier} ${codec}`}`, async () => {
  const opaque = '<f:record xmlns:f="urn:original:future" f:stamp="retained"><!--opaque--><?audit keep?>Retained value</f:record>';
  const selected = owner === "paragraph" ? "keepNext" : "b";
  const originalFields = (action === "remove" ? `<w:${selected}/>` : "") + (owner === "paragraph" ? '<w:jc w:val="center"/>' : '<w:i/>');
  const fields = position === "before" ? opaque + originalFields : originalFields + opaque;
  const inactive = '<f:stored>Inactive property metadata</f:stored>';
  const active = carrier === "direct" ? fields : carrier === "process" ? `<f:pass mc:ProcessContent="f:pass">${fields}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? fields : inactive}</mc:Choice><mc:Fallback>${carrier === "choice" ? inactive : fields}</mc:Fallback></mc:AlternateContent>`;
  const properties = `<w:${owner === "paragraph" ? "pPr" : "rPr"}>${active}</w:${owner === "paragraph" ? "pPr" : "rPr"}>`;
  const body = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f">${owner === "paragraph" ? properties : ""}<w:r>${owner === "run" ? properties : ""}<w:t>Original coast</w:t></w:r></w:p>`;
  const parts = readPackage(await textFixture(body, {}, strict));
  const encodeXml = (xml: string) => codec === "utf8" ? enc(xml) : new Uint8Array(Buffer.from("\ufeff" + xml, "utf16le").swap16());
  const originalXml = new TextDecoder().decode(parts.get("word/document.xml"));
  parts.set("word/document.xml", encodeXml(originalXml));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = action === "add" ? true : null;
  const context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}}};
  if (route === "xml-sdk" || route === "xml-shell") {
    const marker = owner === "paragraph" ? '<w:jc w:val="center"/>' : '<w:i/>';
    const replacement = encodeXml(action === "remove" ? originalXml.replace(`<w:${selected}/>`, "") : originalXml.replace(marker, `<w:${selected}/>` + marker));
    if (route === "xml-sdk") await replaceDocumentXmlPart(input, replacement, {part: "/word/document.xml", output: "-"}, context);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
      const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx xml set /input --part /word/document.xml --file /replacement --output - > /output");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    }
  } else if (route === "model") {
    const doc = await Document(input, textContext);
    if (owner === "paragraph") doc.paragraphs[0]!.paragraph_format.keep_with_next = value;
    else doc.paragraphs[0]!.runs[0]!.bold = value;
    await doc.save(context.stdout);
  } else if (route === "sdk") {
    if (owner === "paragraph") await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, keepWithNext: value, output: "-"}}, context);
    else await formatDocumentRuns(input, {paragraph: 1, run: 1, bold: value, output: "-"}, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const command = owner === "paragraph" ? "paragraphs set /input --paragraph 1 --keep-with-next" : "runs set /input --paragraph 1 --run 1 --bold";
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx ${command} ${value} --output - > /output`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder(codec === "utf8" ? "utf8" : "utf-16be").decode(saved.get("word/document.xml")); expect(xml.split(opaque)).toHaveLength(2);
  if (carrier === "choice" || carrier === "fallback") expect(xml.split(inactive)).toHaveLength(2);
  if (codec === "utf16be") expect(saved.get("word/document.xml")!.slice(0, 2)).toEqual(Uint8Array.of(254, 255));
  const doc = await Document(output, textContext), p = doc.paragraphs[0]!;
  expect(p.text).toBe("Original coast"); expect(owner === "paragraph" ? p.paragraph_format.keep_with_next : p.runs[0]!.bold).toBe(value);
  if (owner === "paragraph") expect(p.paragraph_format.alignment?.name).toBe("CENTER"); else expect(p.runs[0]!.italic).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
