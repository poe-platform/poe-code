import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "virtual-bash";
import {docxCommands} from "virtual-bash/commands/docx";
import {Document, Twips, WD_ORIENT, createDocxInspectionCommandEngine, editDocumentSections, inspectDocumentSections, writeArchive} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const)
for (const carrier of ["direct", "choice", "fallback", "section", "process", "ancestor", "nested"] as const)
for (const action of ["orientation", "page_width", "top_margin"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} updates selected section ${action}; ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const inert = '<f:record audit="retained">Future section</f:record>';
  const alternate = (value: string, fallback = false) => `<mc:AlternateContent><!--carrier--><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inert : value}</mc:Choice><mc:Fallback>${fallback ? value : inert}</mc:Fallback></mc:AlternateContent>`;
  const props = '<w:pgSz w:w="10000" w:h="15000"/><w:pgMar w:top="1000" w:bottom="1000" w:left="1000" w:right="1000"/><w:cols w:num="1"/>';
  const inside = carrier === "choice" || carrier === "fallback" ? alternate(props, carrier === "fallback") : carrier === "process" || carrier === "ancestor" ? `<f:pass>${props}</f:pass>` : carrier === "nested" ? alternate(`<f:pass>${props}</f:pass>`) : props;
  const section = `<w:sectPr><!--geometry-->${inside}<?audit retain?></w:sectPr>`;
  const boundary = `<w:p><w:pPr>${carrier === "section" ? alternate(section) : section}</w:pPr><w:r><w:t>First coast</w:t></w:r></w:p>`;
  const trailing = `<w:p><w:r><w:t>Last coast</w:t></w:r></w:p><w:sectPr>${props}</w:sectPr>`;
  const parts = readPackage(await textFixture((carrier === "ancestor" ? `<f:pass>${boundary}</f:pass>` : boundary) + trailing, {}, strict));
  const source = new TextDecoder().decode(parts.get("word/document.xml")).replace("<w:body>", `<w:body ${attrs}>`);
  parts.set("word/document.xml", encoding === "utf16be" ? new Uint8Array(Buffer.from("\ufeff" + source, "utf16le").swap16()) : enc(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const options = action === "orientation" ? {orientation: WD_ORIENT.LANDSCAPE} : action === "page_width" ? {pageWidth: {value: 600, unit: "pt" as const}} : {topMargin: {value: 40, unit: "pt" as const}};
  if (route === "model") {
    const doc = await Document(input, textContext), selected = doc.sections[0]!;
    if (action === "orientation") selected.orientation = WD_ORIENT.LANDSCAPE;
    else if (action === "page_width") selected.page_width = Twips(12000);
    else selected.top_margin = Twips(800);
    expect(doc.sections.length).toBe(2); await doc.save(sink);
  } else if (route === "sdk") expect((await editDocumentSections(input, {operation: "sections.set", options: {section: 1, output: "-", ...options}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink})).changed).toBe(true);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const flag = action === "orientation" ? "--orientation LANDSCAPE" : action === "page_width" ? "--page-width 600pt" : "--top-margin 40pt";
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx sections set /input --section 1 ${flag} --output - > /output`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name)).toEqual(bytes);
  const xml = new TextDecoder(encoding === "utf16be" ? "utf-16be" : "utf-8").decode(saved.get("word/document.xml"));
  expect(xml).toContain(trailing); expect(xml).toContain("<!--geometry-->"); expect(xml).toContain("<?audit retain?>");
  if (["choice", "fallback", "section", "nested"].includes(carrier)) expect(xml).toContain(inert);
  if (encoding === "utf16be") expect(saved.get("word/document.xml")!.slice(0, 2)).toEqual(Uint8Array.of(254, 255));
  const info = await inspectDocumentSections(output, {}, textContext);
  expect(info.items.map(item => [item.direct.orientation, item.direct.pageWidth, item.direct.topMargin])).toEqual([[action === "orientation" ? "landscape" : "portrait", action === "page_width" ? 12000 : 10000, action === "top_margin" ? 800 : 1000], ["portrait", 10000, 1000]]);
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(["First coast", "Last coast"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
