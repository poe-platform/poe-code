import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, ParagraphStyle, WD_STYLE_TYPE, applyStyleModelBatch, openDocumentStyleModel, createDocument, createDocxInspectionCommandEngine, editDocumentParagraphs, editDocumentStyles, inspectDocumentStyles, validateDocument, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
const ref = (resultHandle: string) => ({resultHandle});
type Node = ReturnType<typeof xmlStructure>;
const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];

async function fixture(strict: boolean, kind: "docx" | "dotx", carrier: "direct" | "choice", declarations: string, body = '<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>') {
  const inactive = '<mc:Fallback><w:style w:type="table" w:styleId="Inactive"><w:name w:val="Inactive"/></w:style></mc:Fallback>';
  const content = carrier === "direct" ? declarations : `<mc:AlternateContent><mc:Choice Requires="w">${declarations}</mc:Choice>${inactive}</mc:AlternateContent>`;
  const parts = readPackage(await textFixture(body, {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><!--before-->${content}<?audit retained?></w:styles>`}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
  return {input, parts, memory, sink, fs, shell, context: {...textContext, stdout: sink, encoding: {order: "input" as const, compression: "store" as const}}, ns: strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, inactive};
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice"] as const) for (const explicit of [false, true]) {
  const attribute = explicit ? ' w:type="paragraph"' : "";
  for (const route of ["model", "style-model", "sdk", "shell"] as const)
  it(`${route} reads ${explicit ? "explicit" : "omitted"} paragraph type in ${carrier}; ${kind} strict=${strict}`, async () => {
    const f = await fixture(strict, kind, carrier, `<w:style${attribute} w:styleId="Coast"><w:name w:val="Coast"/><w:rPr><w:i/></w:rPr></w:style>`);
    if (route === "model" || route === "style-model") {
      const model = route === "model" ? await Document(f.input, textContext) : await openDocumentStyleModel(f.input, textContext);
      const style = model.styles.at("Coast");
      expect(style.type).toEqual(WD_STYLE_TYPE.PARAGRAPH); expect(style).toBeInstanceOf(ParagraphStyle);
      const paragraph = style as ParagraphStyle; expect(paragraph.font.italic).toBe(true);
      expect(paragraph.base_style).toBeNull(); expect(paragraph.next_paragraph_style.equals(style)).toBe(true);
      expect(style.part.blob).toEqual(f.parts.get("word/styles.xml")); await model.save(f.sink);
      for (const [name, bytes] of f.parts) expect(readPackage(new Uint8Array(f.memory.readFileSync("/output") as Buffer)).get(name), name).toEqual(bytes);
    } else {
      let data: Awaited<ReturnType<typeof inspectDocumentStyles>>;
      if (route === "sdk") data = await inspectDocumentStyles(f.input, {name: "Coast"}, textContext);
      else {const result = await f.shell.exec("docx styles get /input --name Coast --json"); expect(result.exitCode, result.stderr).toBe(0); data = JSON.parse(result.stdout).data;}
      expect(data.styles).toHaveLength(1); expect(data.styles[0]).toMatchObject({id: "Coast", type: "paragraph", next: "Coast", direct: {italic: true}});
      expect(data.diagnostics).toEqual([]);
    }
    expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
  });

  for (const level of [undefined, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  for (const route of ["model", "batch-sdk", "batch-shell", "create-sdk", "create-shell", "paragraph-sdk", "paragraph-shell"] as const)
  it(`${route} reuses ${explicit ? "explicit" : "omitted"} paragraph type for ${level === undefined ? "named insertion" : "heading " + level} in ${carrier}; ${kind} strict=${strict}`, async () => {
    const name = level === undefined ? "Coast" : level === 0 ? "Title" : `Heading ${level}`;
    const id = level === undefined ? "Coast" : level === 0 ? "Title" : `Heading${level}`;
    const definition = `<w:style${attribute} w:styleId="${id}"><w:name w:val="${name}"/>${level ? `<w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>` : ""}<w:rPr><w:i/></w:rPr></w:style>`;
    const f = await fixture(strict, kind, carrier, definition);
    const options = level === undefined ? {style: name} : {level};
    const batch = {version: 1 as const, operations: [{operation: level === undefined ? "model.document.Document.add_paragraph.call" : "model.document.Document.add_heading.call", receiver: ref("document"), arguments: {text: "Added coast", ...options}}]};
    const content = {version: 1 as const, blocks: [{kind: "paragraph" as const, text: "Added coast", ...options}]};
    if (route === "model") {
      const doc = await Document(f.input, textContext), handle = doc.styles.at(name);
      const added = level === undefined ? doc.add_paragraph("Added coast", name) : doc.add_heading("Added coast", level);
      expect(added.style?.equals(handle)).toBe(true); await doc.save(f.sink);
    } else if (route === "batch-sdk") await (await applyStyleModelBatch(f.input, batch, textContext)).save(f.sink);
    else if (route === "create-sdk") await createDocument({template: f.input, content}, {output: "-"}, f.context);
    else if (route === "paragraph-sdk") await editDocumentParagraphs(f.input, {operation: "paragraphs.add", options: {text: "Added coast", ...options, output: "-"}}, f.context);
    else {
      const command = route === "batch-shell" ? "docx batch /input --ops-json " + quote(JSON.stringify(batch))
        : route === "create-shell" ? "docx create --template /input --content-json " + quote(JSON.stringify(content))
        : "docx paragraphs add /input --text 'Added coast' " + (level === undefined ? "--style " + quote(name) : "--level " + level);
      const result = await f.shell.exec(command + " --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); f.memory.writeFileSync("/output", await f.fs.readFile("/output"));
    }
    const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    expect([...saved.keys()].sort()).toEqual([...f.parts.keys()].sort());
    for (const [part, bytes] of f.parts) if (part !== "word/document.xml") expect(saved.get(part), part).toEqual(bytes);
    expect(flatten(xmlStructure(saved.get("word/document.xml")!)).filter(n => n.name === `{${f.ns}}pStyle`).map(n => n.attributes[`{${f.ns}}val`])).toEqual([id]);
    assertPackageLinks(saved); const report = await validateDocument(output, textContext); expect(report.valid, JSON.stringify(report.diagnostics)).toBe(true);
    const reopened = await Document(output, textContext); expect(reopened.paragraphs.map(p => p.text)).toEqual(["Original coast", "Added coast"]); expect(reopened.paragraphs[1]!.style?.style_id).toBe(id);
    expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
  });
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice"] as const)
for (const omitted of ["neither", "source", "target", "both"] as const)
for (const route of ["model", "style-model", "batch-sdk", "batch-shell", "sdk", "shell"] as const)
it(`${route} retains paragraph base/next types with ${omitted} omitted in ${carrier}; ${kind} strict=${strict}`, async () => {
  const sourceType = omitted === "source" || omitted === "both" ? "" : ' w:type="paragraph"', targetType = omitted === "target" || omitted === "both" ? "" : ' w:type="paragraph"';
  const f = await fixture(strict, kind, carrier, `<w:style${sourceType} w:styleId="Coast"><w:name w:val="Coast"/><!--source--></w:style><w:style${targetType} w:styleId="Base" w:default="1"><w:name w:val="Base"/><w:rPr><w:i/></w:rPr></w:style><w:style w:type="character" w:styleId="Accent"><w:name w:val="Accent"/></w:style>`);
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    ...["Coast", "Base"].map(key => ({operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: {key}, resultHandle: key})),
    {operation: "model.styles.style.CharacterStyle.base_style.set", receiver: ref("Coast"), arguments: {value: ref("Base")}},
    {operation: "model.styles.style.ParagraphStyle.next_paragraph_style.set", receiver: ref("Coast"), arguments: {value: ref("Base")}}
  ]};
  if (route === "model" || route === "style-model") {
    const model = route === "model" ? await Document(f.input, textContext) : await openDocumentStyleModel(f.input, textContext);
    const style = model.styles.at("Coast") as ParagraphStyle, base = model.styles.at("Base");
    expect(style).toBeInstanceOf(ParagraphStyle); expect(base).toBeInstanceOf(ParagraphStyle);
    style.base_style = base; style.next_paragraph_style = base;
    expect(style.base_style?.equals(base)).toBe(true); expect(style.next_paragraph_style.equals(base)).toBe(true); await model.save(f.sink);
  } else if (route === "batch-sdk") await (await applyStyleModelBatch(f.input, batch, textContext)).save(f.sink);
  else if (route === "sdk") await editDocumentStyles(f.input, {operation: "styles.set", name: "Coast", base: "Base", next: "Base", linkedStyle: "Accent", defaultForType: true, output: "-"}, f.context);
  else {
    const command = route === "batch-shell" ? "docx batch /input --ops-json " + quote(JSON.stringify(batch)) : "docx styles set /input --name Coast --base Base --next Base --linked-style Accent --default-for-type true";
    const result = await f.shell.exec(command + " --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); f.memory.writeFileSync("/output", await f.fs.readFile("/output"));
  }
  const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [part, bytes] of f.parts) if (part !== "word/styles.xml") expect(saved.get(part), part).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("word/styles.xml")); expect(xml).toContain("<!--source-->"); expect(xml).toContain("<!--before-->"); expect(xml).toContain("<?audit retained?>"); if (carrier === "choice") expect(xml).toContain(f.inactive);
  const styles = flatten(xmlStructure(saved.get("word/styles.xml")!)).filter(n => n.name === `{${f.ns}}style`), coast = styles.find(n => n.attributes[`{${f.ns}}styleId`] === "Coast")!, base = styles.find(n => n.attributes[`{${f.ns}}styleId`] === "Base")!;
  expect(coast.attributes[`{${f.ns}}type`]).toBe(sourceType ? "paragraph" : undefined); expect(base.attributes[`{${f.ns}}type`]).toBe(targetType ? "paragraph" : undefined);
  for (const tag of ["basedOn", "next"]) expect(flatten(coast).find(n => n.name === `{${f.ns}}${tag}`)?.attributes[`{${f.ns}}val`]).toBe("Base");
  if (route === "sdk" || route === "shell") {expect(coast.attributes[`{${f.ns}}default`]).toBe("1"); expect(base.attributes[`{${f.ns}}default`]).toBeUndefined(); expect(flatten(coast).find(n => n.name === `{${f.ns}}link`)?.attributes[`{${f.ns}}val`]).toBe("Accent");}
  const report = await validateDocument(output, textContext); expect(report.valid, JSON.stringify(report.diagnostics)).toBe(true); assertPackageLinks(saved);
  const info = await inspectDocumentStyles(output, {name: "Coast"}, textContext); expect(info.styles[0]).toMatchObject({type: "paragraph", base: "Base", next: "Base", effective: {italic: true}});
  expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} detects explicit plus omitted paragraph defaults in ${carrier}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, carrier, '<w:style w:styleId="Coast" w:default="1"><w:name w:val="Coast"/></w:style><w:style w:type="paragraph" w:styleId="Base" w:default="1"><w:name w:val="Base"/></w:style>');
  if (route === "sdk") {
    const report = await validateDocument(f.input, textContext);
    expect(report.valid).toBe(false); expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code: "style-default"})]));
  } else {
    const result = await f.shell.exec("docx validate /input --json"); expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({operation: "validate", ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({code: "invalid-package", message: "A style type has multiple defaults.", part: "/word/styles.xml"})]});
  }
  expect(await f.fs.readFile("/input")).toEqual(f.input);
});
