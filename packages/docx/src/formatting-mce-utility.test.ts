import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, ParagraphStyle, WD_ALIGN_PARAGRAPH, createDocxInspectionCommandEngine, editDocumentParagraphs, editDocumentStyles, formatDocumentRuns, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006", enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const) for (const owner of ["paragraph", "style"] as const)
for (const carrier of ["direct", "choice", "fallback", "containers", "process", "ancestor"] as const)
for (const action of ["alignment", "bold"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} changes native ${owner} ${action} via direct utility; ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const attrs = `xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"`;
  const inactive = '<f:record audit="unchanged">Stored alternative</f:record>';
  const alternate = (value: string, fallback = false) => `<mc:AlternateContent><!--carrier--><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : value}</mc:Choice><mc:Fallback>${fallback ? value : inactive}</mc:Fallback></mc:AlternateContent>`;
  const property = (name: string, value: string) => {
    if (carrier === "containers") return alternate(`<w:${name}>${value}</w:${name}>`);
    return `<w:${name}><!--property-->${carrier === "choice" ? alternate(value) : carrier === "fallback" ? alternate(value, true) : carrier === "process" || carrier === "ancestor" ? `<f:pass>${value}</f:pass>` : value}<?retained value?></w:${name}>`;
  };
  const p = property("pPr", '<w:jc w:val="center"/><w:keepNext/>'), r = property("rPr", '<w:b/><w:i w:val="0"/><w:color w:val="123456"/>');
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
  if (route === "sdk") {
    if (owner === "style") expect((await editDocumentStyles(input, {operation: "styles.set", name: "Coast", output: "-", ...(action === "alignment" ? {alignment: WD_ALIGN_PARAGRAPH.LEFT} : {bold: false})}, context)).changed).toBe(true);
    else if (action === "alignment") expect((await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, alignment: WD_ALIGN_PARAGRAPH.LEFT, output: "-"}}, context)).changed).toBe(true);
    else expect((await formatDocumentRuns(input, {paragraph: 1, run: 1, bold: false, output: "-"}, context)).changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const command = owner === "style" ? "styles set /input --name Coast" : action === "alignment" ? "paragraphs set /input --paragraph 1" : "runs set /input --paragraph 1 --run 1";
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx ${command} --${action} ${action === "alignment" ? "LEFT" : "false"} --output - > /output`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== target) expect(saved.get(name), name).toEqual(bytes);
  const actual = new TextDecoder(encoding === "utf16be" ? "utf-16be" : "utf-8").decode(saved.get(target));
  if (encoding === "utf16be") expect(saved.get(target)!.slice(0, 2)).toEqual(Uint8Array.of(254, 255));
  if (carrier === "choice" || carrier === "fallback" || carrier === "containers") expect(actual.split(inactive).length).toBe(3);
  if (carrier !== "containers") {expect(actual.split("<!--property-->").length).toBe(3); expect(actual.split("<?retained value?>").length).toBe(3);}
  const doc = await Document(output, textContext), selected = owner === "style" ? doc.styles.at("Coast") as ParagraphStyle : doc.paragraphs[0]!;
  const format = selected.paragraph_format, font = selected instanceof ParagraphStyle ? selected.font : selected.runs[0]!.font;
  expect(format.alignment?.name).toBe(action === "alignment" ? "LEFT" : "CENTER"); expect(format.keep_with_next).toBe(true);
  expect(font.bold).toBe(action !== "bold"); expect(font.italic).toBe(false); expect(font.color.rgb?.toString()).toBe("123456");
  expect(doc.paragraphs[0]!.text).toBe("Original coast"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
