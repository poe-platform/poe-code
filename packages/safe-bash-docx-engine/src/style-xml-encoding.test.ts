import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, openDocumentStyleModel, applyStyleModelBatch, createDocxInspectionCommandEngine, createDocument, editDocumentStyles, inspectDocumentStyles, writeArchive, WD_STYLE_TYPE, ParagraphStyle } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { fidelityBytes, type FidelityEncoding } from "../tests/fixtures/xml-fidelity.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const encodings: FidelityEncoding[] = ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"];
const encode = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string) => ({resultHandle});
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of encodings) for (const carrier of ["direct", "choice"] as const)
for (const route of ["model", "style-model", "batch-sdk", "batch-shell", "sdk", "shell"] as const)
for (const action of ["copy", "format", "add"] as const)
it(`${route} ${action} retains ${encoding} styles in ${carrier}; ${kind} strict=${strict}`, async () => {
  const opaque = '<f:record f:stamp="keep"> lead <![CDATA[opaque <&>]]> e&#x301; 海 🧭 </f:record>';
  const definition = '<w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coastal 海"/><w:aliases w:val="retained"/><!--inside--><?audit inside?><w:rPr><w:i/></w:rPr></w:style>';
  const inactive = '<mc:Fallback><w:style w:type="paragraph" w:styleId="Inert"><w:name w:val="Unselected"/><w:rPr><w:b/></w:rPr></w:style></mc:Fallback>';
  const content = carrier === "direct" ? definition : '<mc:AlternateContent><mc:Choice Requires="w">' + definition + '</mc:Choice>' + inactive + '</mc:AlternateContent>';
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-encoding" mc:Ignorable="f">${content}${opaque}</w:styles>`}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const encodingName = encoding === "UTF-8-BOM" ? "UTF-8" : encoding;
  const prolog = `<?xml version="1.0" encoding="${encodingName}" standalone="yes"?>\r\n<!--before--><?audit before?>`, epilog = '<!--after--><?audit after?>';
  const source = prolog + new TextDecoder().decode(parts.get("word/styles.xml")) + epilog;
  parts.set("word/styles.xml", fidelityBytes(source, encoding));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = {...textContext, stdout: sink, encoding: {order: "input" as const, compression: "store" as const}};
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: {key: "Coastal 海"}, resultHandle: "style"},
    ...(action === "format" ? [
      {operation: "model.styles.style.ParagraphStyle.font.get", receiver: ref("style"), arguments: {}, resultHandle: "font"},
      {operation: "model.text.run.Font.bold.set", receiver: ref("font"), arguments: {value: true}}
    ] : action === "add" ? [
      {operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: {name: "New 海", styleType: {enum: "WD_STYLE_TYPE", name: "PARAGRAPH"}}}
    ] : [{operation: "model.styles.style.BaseStyle.style_id.get", receiver: ref("style"), arguments: {}}])
  ]};
  if (route === "model" || route === "style-model") {
    const document = route === "model" ? await Document(input, textContext) : await openDocumentStyleModel(input, textContext);
    const style = document.styles.at("Coastal 海") as ParagraphStyle, part = style.part;
    expect(style.style_id).toBe("Coast"); expect(style.font.italic).toBe(true);
    expect(part.blob).toEqual(parts.get("word/styles.xml"));
    const snapshot = part.blob; snapshot.fill(0); expect(part.blob).toEqual(parts.get("word/styles.xml"));
    if ("add_heading" in document) {
      const count = document.styles.length;
      expect(() => document.add_heading("\u0000", 3)).toThrow();
      expect(document.styles.length).toBe(count);
      expect(part.blob).toEqual(parts.get("word/styles.xml"));
      expect(document.part.blob).toEqual(parts.get("word/document.xml"));
    }
    if (action === "format") { style.font.bold = true; expect(style.font.bold).toBe(true); }
    if (action === "add") expect(document.styles.add_style("New 海", WD_STYLE_TYPE.PARAGRAPH).name).toBe("New 海");
    expect(style.style_id).toBe("Coast"); expect(style.part).toBe(part); expect(style.font.italic).toBe(true);
    await document.save(sink);
  } else if (route === "batch-sdk") {
    const applied = await applyStyleModelBatch(input, batch, textContext);
    if (action === "copy") expect(applied.results.at(-1)).toMatchObject({value: "Coast"});
    await applied.save(sink);
  } else if (route === "sdk") {
    expect((await inspectDocumentStyles(input, {name: "Coastal 海"}, textContext)).styles[0]).toMatchObject({id: "Coast", direct: {italic: true}});
    if (action === "copy") await createDocument({template: input}, {output: "-"}, context);
    else await editDocumentStyles(input, action === "format" ? {operation: "styles.set", name: "Coastal 海", bold: true, output: "-"} : {operation: "styles.add", name: "New 海", type: "paragraph", output: "-"}, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const command = route === "batch-shell" ? "docx batch /input --ops-json " + quote(JSON.stringify(batch)) : action === "copy" ? "docx create --template /input" : action === "format" ? "docx styles set /input --name 'Coastal 海' --bold true" : "docx styles add /input --name 'New 海' --type paragraph";
    const result = await shell.exec(command + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), bytes = saved.get("word/styles.xml")!;
  for (const [name, original] of parts) if (name !== "word/styles.xml" || action === "copy") expect(saved.get(name), name).toEqual(original);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  const prefix = encoding === "UTF-8" ? 0 : encoding === "UTF-8-BOM" ? 3 : 2;
  expect(bytes.subarray(0, prefix)).toEqual(parts.get("word/styles.xml")!.subarray(0, prefix));
  const decoded = new TextDecoder(encodingName, {fatal: true}).decode(bytes);
  expect(decoded.startsWith(prolog)).toBe(true); expect(decoded.endsWith(epilog)).toBe(true); expect(decoded).toContain(opaque);
  if (carrier === "choice") expect(decoded).toContain(inactive);
  expect(decoded).toContain('<!--inside--><?audit inside?>'); expect(decoded).toContain('<w:aliases w:val="retained"/>');
  if (action !== "format") expect(decoded).toContain(definition);
  type Node = ReturnType<typeof xmlStructure>;
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, nodes = flatten(xmlStructure(encode(decoded))), styles = nodes.filter(node => node.name === `{${ns}}style`);
  expect(styles.length).toBe(1 + Number(carrier === "choice") + Number(action === "add"));
  const old = styles.find(node => node.attributes[`{${ns}}styleId`] === "Coast")!;
  expect(flatten(old).some(node => node.name === `{${ns}}b`)).toBe(action === "format");
  expect(flatten(old).some(node => node.name === `{${ns}}i`)).toBe(true);
  const normalized = new Map(saved); normalized.set("word/styles.xml", encode(decoded)); assertPackageLinks(normalized);
  expect((await Document(output, textContext)).paragraphs.map(paragraph => paragraph.text)).toEqual(["Original coast"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
