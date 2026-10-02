import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, ParagraphStyle, WD_ALIGN_PARAGRAPH, Twips, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006", enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const) for (const owner of ["paragraph", "style"] as const)
for (const carrier of ["direct", "choice", "fallback", "containers", "process", "ancestor"] as const)
for (const action of ["alignment", "bold", "position", "remove", "clear", "add", "raw", "raw-remove"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} changes native ${owner} ${action} via typed public owner; ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const attrs = `xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"`;
  const inactive = '<f:record audit="unchanged">Stored alternative</f:record>';
  const alternate = (value: string, fallback = false) => `<mc:AlternateContent><!--carrier--><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : value}</mc:Choice><mc:Fallback>${fallback ? value : inactive}</mc:Fallback></mc:AlternateContent>`;
  const property = (name: string, value: string) => {
    if (carrier === "containers") return alternate(`<w:${name}>${value}</w:${name}>`);
    return `<w:${name}><!--property-->${carrier === "choice" ? alternate(value) : carrier === "fallback" ? alternate(value, true) : carrier === "process" || carrier === "ancestor" ? `<f:pass>${value}</f:pass>` : value}<?retained value?></w:${name}>`;
  };
  const p = property("pPr", '<w:jc w:val="center"/><w:keepNext/><w:tabs><w:tab w:val="right" w:pos="720" w:leader="dot"/><!--stop--><w:tab w:val="left" w:pos="2160"/></w:tabs>'), r = property("rPr", '<w:b/><w:i w:val="0"/><w:color w:val="123456"/>');
  const main = `<w:p ${attrs}>${p}<w:r>${r}<w:t>Original coast</w:t></w:r></w:p>`;
  const style = `<w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/>${p}${r}</w:style>`;
  const styles = `<w:styles xmlns:w="${w}" ${attrs}>${carrier === "ancestor" ? `<f:pass>${style}</f:pass>` : style}</w:styles>`;
  const parts = readPackage(await textFixture(owner === "paragraph" ? carrier === "ancestor" ? `<f:pass ${attrs}>${main}</f:pass>` : main : '<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', owner === "style" ? {styles: {kind: "styles", xml: styles}} : {}, strict));
  const target = owner === "style" ? "word/styles.xml" : "word/document.xml";
  if (encoding === "utf16be") { const bytes = Buffer.from("\ufeff" + new TextDecoder().decode(parts.get(target)), "utf16le"); parts.set(target, new Uint8Array(bytes.swap16())); }
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: {async write(bytes: Uint8Array) {volume.appendFileSync("/output", bytes);}}};
  const doc = await Document(input, textContext), selected = owner === "style" ? doc.styles.at("Coast") as ParagraphStyle : doc.paragraphs[0]!;
  const format = selected.paragraph_format, font = selected instanceof ParagraphStyle ? selected.font : selected.runs[0]!.font;
  const tabs = format.tab_stops, first = tabs.at(0), retained = tabs.at(1);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
  const operations: unknown[] = owner === "style" ? [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: {key: "Coast"}, resultHandle: "selected"},
    {operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: ref("selected"), arguments: {}, resultHandle: "format"},
    {operation: "model.styles.style.ParagraphStyle.font.get", receiver: ref("selected"), arguments: {}, resultHandle: "font"}
  ] : [
    {operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format"},
    {operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs"},
    {operation: "model.text.run.Run.font.get", receiver: ref("runs", 0), arguments: {}, resultHandle: "font"}
  ];
  operations.push(
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "tabs"},
    {operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("tabs"), arguments: {index: 0}, resultHandle: "first"},
    {operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("tabs"), arguments: {index: 1}, resultHandle: "retained"},
    {operation: "model.text.tabstops.TabStop.element.get", receiver: ref("first"), arguments: {}, resultHandle: "element"}
  );
  const last = action === "alignment" ? {operation: "model.text.parfmt.ParagraphFormat.alignment.set", receiver: ref("format"), arguments: {value: WD_ALIGN_PARAGRAPH.LEFT}} :
    action === "bold" ? {operation: "model.text.run.Font.bold.set", receiver: ref("font"), arguments: {value: false}} :
    action === "position" ? {operation: "model.text.tabstops.TabStop.position.set", receiver: ref("first"), arguments: {value: {value: 1440, unit: "twip"}}} :
    action === "remove" ? {operation: "model.text.tabstops.TabStops.__delitem__.call", receiver: ref("tabs"), arguments: {index: 0}} :
    action === "clear" ? {operation: "model.text.tabstops.TabStops.clear_all.call", receiver: ref("tabs"), arguments: {}} :
    action === "add" ? {operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: ref("tabs"), arguments: {position: {value: 1440, unit: "twip"}}} :
    action === "raw" ? {operation: "model.XmlElementView.set_attribute.call", receiver: ref("element"), arguments: {name: {namespaceURI: word, localName: "pos"}, value: "1440"}} :
    {operation: "model.XmlElementView.remove.call", receiver: ref("element"), arguments: {}};
  const batch = {version: 1, operations: [...operations, last, ...(action === "clear" ? [] : [{operation: "model.text.tabstops.TabStop.position.get", receiver: ref("retained"), arguments: {}}])]};
  if (route === "model") {
    if (action === "alignment") format.alignment = WD_ALIGN_PARAGRAPH.LEFT;
    else if (action === "bold") font.bold = false;
    else if (action === "position") first.position = Twips(1440);
    else if (action === "remove") tabs.remove(0);
    else if (action === "clear") tabs.clear_all();
    else if (action === "add") tabs.add_tab_stop(Twips(1440));
    else if (action === "raw") first.element.set_attribute({namespaceURI: word, localName: "pos"}, "1440");
    else first.element.remove();
    if (action === "clear") expect(() => retained.position).toThrowError(expect.objectContaining({code: "stale-selection"}));
    else expect(retained.position.twips).toBe(2160);
    await doc.save(context.stdout);
  } else if (route === "sdk") {
    const result = await executeDocumentBatch(input, batch, {output: "-"}, context);
    expect(result.publication?.changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output - > /output");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== target) expect(saved.get(name), name).toEqual(bytes);
  const actual = new TextDecoder(encoding === "utf16be" ? "utf-16be" : "utf-8").decode(saved.get(target));
  if (encoding === "utf16be") expect(saved.get(target)!.slice(0, 2)).toEqual(Uint8Array.of(254, 255));
  if (carrier === "choice" || carrier === "fallback" || carrier === "containers") expect(actual.split(inactive).length).toBe(3);
  if (carrier !== "containers") {expect(actual.split("<!--property-->").length).toBe(3); expect(actual.split("<?retained value?>").length).toBe(3);}
  const reloaded = await Document(output, textContext), after = owner === "style" ? reloaded.styles.at("Coast") as ParagraphStyle : reloaded.paragraphs[0]!;
  const afterFormat = after.paragraph_format, afterFont = after instanceof ParagraphStyle ? after.font : after.runs[0]!.font;
  expect(afterFormat.alignment?.name).toBe(action === "alignment" ? "LEFT" : "CENTER"); expect(afterFormat.keep_with_next).toBe(true);
  expect(afterFont.bold).toBe(action !== "bold"); expect(afterFont.italic).toBe(false); expect(afterFont.color.rgb?.toString()).toBe("123456");
  expect([...afterFormat.tab_stops].map(tab => tab.position.twips)).toEqual(action === "clear" ? [] : action === "remove" || action === "raw-remove" ? [2160] : action === "position" || action === "raw" ? [1440, 2160] : action === "add" ? [720, 1440, 2160] : [720, 2160]);
  expect(reloaded.paragraphs[0]!.text).toBe("Original coast"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
