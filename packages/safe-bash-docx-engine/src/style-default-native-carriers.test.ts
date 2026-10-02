import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, paragraph } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const foreign = "urn:original:default-carrier";
const descendants = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(descendants)];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const spelling of ["w", "alternate", "default"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const placement of ["defaults", "container", "properties", "leaf"] as const)
for (const property of ["font", "indent"] as const)
for (const action of ["patch", "reset", "unchanged"] as const)
for (const route of ["sdk-direct", "sdk-batch", "cli-direct", "cli-batch"] as const)
if (carrier !== "direct" || placement === "leaf") it(`${route} ${action} ${property} defaults retain active ${placement}/${carrier} ${spelling} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const known = spelling === "default" ? "w" : spelling;
  const inert = '<f:opaque f:identity="retained"><w:rFonts w:ascii="INERT"/><w:ind w:left="999"/></f:opaque>';
  const wrap = (markup: string, level: string) => placement !== level || carrier === "direct" ? markup : carrier === "process" ? `<f:pass>${markup}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? known : "f"}">${carrier === "choice" ? markup : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? markup : inert}</mc:Fallback></mc:AlternateContent>`;
  const leaf = property === "font" ? '<w:rFonts w:ascii="Original" w:hAnsi="Original" w:eastAsia="Stored CJK" f:metadata="keep"/>' : `<w:ind w:${strict ? "start" : "left"}="720" w:${strict ? "end" : "right"}="360" f:metadata="keep"/>`;
  const prop = property === "font" ? "rPr" : "pPr", container = property === "font" ? "rPrDefault" : "pPrDefault";
  const properties = wrap(`<w:${prop}>${wrap(leaf, "leaf")}${property === "font" ? '<w:b/><w:rtl/>' : '<w:keepNext/>'}${inert}<!--retain--><?policy keep?></w:${prop}>`, "properties");
  const defaults = wrap(`<w:docDefaults>${wrap(`<w:${container}>${properties}</w:${container}>`, "container")}</w:docDefaults>`, "defaults");
  const raw = `<w:styles xmlns:w="${w}" xmlns:f="${foreign}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${defaults}<w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/></w:style><!--root--><?audit retain?></w:styles>`;
  const source = spelling === "default" ? raw.split("<w:").join("<").split("</w:").join("</").replace("<styles ", `<styles xmlns="${w}" `) : raw.replace("xmlns:w=", `xmlns:${spelling}=`).split("w:").join(`${spelling}:`);
  const input = await textFixture(paragraph("Retain 日本 עברית é 🌊"), { styles: {kind: "styles", xml: source}}, strict,
    { kind, modified: new Date("2026-01-02T03:04:06Z") });
  const parts = readPackage(input);
  const memory = Volume.fromJSON({"/input": Buffer.from(input), "/output":""});
  const args = property === "font" ? {font:action === "reset" ? null : action === "patch" ? "Changed Latin" : "Original"} : {leftIndent:action === "reset" ? null : {value:action === "patch" ? 72 : 36, unit:"pt" as const}};
  const batch = {version:1, operations:[{operation:"styles.defaults.set", arguments:args}]};
  const pub = {...textContext, encoding:{order:"input" as const,compression:"store" as const}, stdout:{async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}}};
  if (route === "sdk-direct") { const result = await api.editDocumentStyles(input,{operation:"styles.defaults.set",...args,output:"-"},pub); expect(result.changed).toBe(action !== "unchanged"); }
  else if (route === "sdk-batch") {const result = await api.executeDocumentBatch(input,batch,{output:"-"},pub); expect(result.results.reduce((sum, item) => sum + item.affected, 0)).toBe(Number(action !== "unchanged"));}
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input",input);
    const shell = new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));
    try {
      const flags = property === "font" ? `--font '${args.font === null ? "null" : args.font}'` : `--left-indent ${args.leftIndent === null ? "null" : action === "patch" ? "72pt" : "36pt"}`;
      const command = route === "cli-direct" ? `docx styles defaults set /input ${flags} --output /output --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /output --json`;
      const result = await shell.exec(command); expect(result.exitCode,result.stdout+result.stderr).toBe(0); expect(JSON.parse(result.stdout).affected).toBe(Number(action !== "unchanged"));
      expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output",await fs.readFile("/output"));
    } finally {await shell.dispose();}
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); assertPackageLinks(saved); expect(saved.size).toBe(parts.size);
  for (const [name,bytes] of parts) if (name !== "word/styles.xml" || action === "unchanged") expect(saved.get(name),name).toEqual(bytes);
  const info = await api.inspectDocumentStyles(output,{},textContext);
  if (property === "font") expect(info.defaults.run.font).toBe(action === "reset" ? null : action === "patch" ? "Changed Latin" : "Original");
  else expect(info.defaults.paragraph.leftIndent).toBe(action === "reset" ? null : action === "patch" ? 72 : 36);
  const before = new api.DocumentXmlEditor(parts.get("word/styles.xml")!), after = new api.DocumentXmlEditor(saved.get("word/styles.xml")!);
  const leaves = descendants(after.root).filter(n=>n.attributes.some(a=>a.namespace===foreign && a.localName==="metadata")); expect(leaves).toHaveLength(1);
  const original = descendants(before.root).find(n=>n.attributes.some(a=>a.namespace===foreign && a.localName==="metadata"))!;
  const changed = leaves[0]!; expect(changed.name).toBe(original.name); expect([...changed.namespaces]).toEqual([...original.namespaces]);
  const attrs = (node:api.XmlElement) => Object.fromEntries(node.attributes.filter(a=>a.namespace===w).map(a=>[a.localName,a.value]));
  const expected = {...attrs(original)};
  if (property === "font") {if(action === "reset"){delete expected.ascii;delete expected.hAnsi;}else if(action === "patch"){expected.ascii="Changed Latin";expected.hAnsi="Changed Latin";}}
  else if(action === "reset") delete expected[strict ? "start" : "left"];
  else if(action === "patch") {if(strict){delete expected.left;expected.start="1440";}else expected.left="1440";}
  expect(attrs(changed)).toEqual(expected);
  const retained = (xml:api.DocumentXmlEditor) => descendants(xml.root).filter(n=>n.namespace===foreign && n.localName==="opaque").map(n=>xml.sourceXml(n));
  expect(retained(after)).toEqual(retained(before));
  const activeLeaves = descendants(after.root).filter(n=>n.namespace===w && n.localName===(property === "font" ? "rFonts" : "ind") && n.attributes.some(a=>a.namespace===foreign && a.localName==="metadata")); expect(activeLeaves).toHaveLength(1);
  expect(new TextDecoder().decode(saved.get("word/styles.xml"))).toContain("<!--retain--><?policy keep?>");
  const model = await api.Document(output,textContext); expect(model.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊");
  if(property === "font"){expect(info.defaults.run.bold).toBe(true);expect(info.defaults.run.rtl).toBe(true);}else expect(info.defaults.paragraph.keepWithNext).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
