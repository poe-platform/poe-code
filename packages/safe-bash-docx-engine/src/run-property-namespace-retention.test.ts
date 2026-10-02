import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const encode = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const spelling of ["default", "prefixed"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const property of ["font", "language"] as const)
for (const route of ["model-batch", "sdk-direct", "sdk-batch", "cli-direct", "cli-batch"] as const)
it(`${route} retains ignored attribute namespace context during ${property} edits; ${spelling} ${carrier} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const retained = '<f:opaque f:identity="retained"><w:rFonts w:ascii="INERT"/><w:lang w:val="BAD"/></f:opaque>';
  const leaves = '<w:rFonts w:ascii="Stored Latin" w:hAnsi="Stored High" w:eastAsia="Stored CJK" f:metadata="keep"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA" f:metadata="keep"/>';
  const wrapped = carrier === "direct" ? leaves : carrier === "process" ? `<f:pass>${leaves}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? leaves : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? leaves : ""}</mc:Fallback></mc:AlternateContent>`;
  const xml = `<w:document xmlns:w="${w}" xmlns:f="urn:original:run-namespace" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:body><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:rtl/>${wrapped}${retained}</w:rPr><w:t>Retain 日本 עברית é 🌊</w:t><!--retain--><?policy keep?></w:r></w:p></w:body></w:document>`;
  const source = spelling === "prefixed" ? xml : xml.split("<w:").join("<").split("</w:").join("</").replace("<document ", `<document xmlns="${w}" `);
  const parts = readPackage(await textFixture("", {}, strict)); parts.set("word/document.xml", encode(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name,bytes]) => ({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes){memory.appendFileSync("/input",bytes);}}, {order:"input",compression:"store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const args = property === "font" ? {ascii:"Changed 日本"} : {language:"zh-Hant-TW"};
  const batch = {version:1, operations:[{operation:"runs.set", arguments:{paragraph:1,run:1,...args}}]};
  const sink = {async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}};
  const pub = {...textContext, encoding:{order:"input" as const,compression:"store" as const}, stdout:sink};
  if (route === "model-batch") {
    const model = {version:1, operations:[{operation:"runs.get", arguments:{paragraph:1,run:1}, resultHandle:"run"}, {operation:"runs.fonts.set", receiver:{resultHandle:"run"}, arguments:property === "font" ? args : {language:{latin:"zh-Hant-TW"}}}]};
    const result = await api.applyStyleModelBatch(input,model,textContext); expect(result.affected).toBe(1); await result.save(sink);
  } else if (route === "sdk-direct") await api.formatDocumentRuns(input,{paragraph:1,run:1,...args,output:"-"},pub);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input,batch,{output:"-"},pub);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input",input);
    const shell = new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));
    try {
      const command = route === "cli-direct" ? `docx runs set /input --paragraph 1 --run 1 ${property === "font" ? "--ascii 'Changed 日本'" : "--language zh-Hant-TW"} --output /output --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /output --json`;
      const result = await shell.exec(command); expect(result.exitCode,result.stdout+result.stderr).toBe(0); expect(JSON.parse(result.stdout).affected).toBe(1); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output",await fs.readFile("/output"));
    } finally {await shell.dispose();}
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); assertPackageLinks(saved); expect(saved.size).toBe(parts.size);
  for (const [name,bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name),name).toEqual(bytes);
  const before = api.parseDocumentXml(parts.get("word/document.xml")!), after = api.parseDocumentXml(saved.get("word/document.xml")!);
  const nodes = (node:api.XmlElement): api.XmlElement[] => [node,...node.children.flatMap(nodes)];
  const attrs = (node:api.XmlElement) => Object.fromEntries(node.attributes.filter(a => a.namespace === w).map(a=>[a.localName,a.value]));
  for (const local of ["rFonts","lang"]) {
    const original = nodes(before.root).find(n=>n.namespace===w && n.localName===local)!;
    const changed = nodes(after.root).find(n=>n.namespace===w && n.localName===local)!;
    expect([...changed.namespaces]).toEqual([...original.namespaces]); expect(changed.name).toBe(original.name);
    expect(changed.attributes.find(a=>a.namespace==="urn:original:run-namespace" && a.localName==="metadata")?.value).toBe("keep");
    expect(attrs(changed)).toEqual({...attrs(original),...(local===(property==="font"?"rFonts":"lang") ? property==="font"?{ascii:"Changed 日本"}:{val:"zh-Hant-TW"}: {})});
  }
  const a = new api.DocumentXmlEditor(saved.get("word/document.xml")!), b = new api.DocumentXmlEditor(parts.get("word/document.xml")!);
  expect(a.sourceXml(nodes(a.root).find(n=>n.localName==="opaque")!)).toBe(b.sourceXml(nodes(b.root).find(n=>n.localName==="opaque")!));
  expect(new TextDecoder().decode(saved.get("word/document.xml"))).toContain("<!--retain--><?policy keep?>");
  const paragraph = (await api.Document(output,textContext)).paragraphs[0]!;
  expect(paragraph.text).toBe("Retain 日本 עברית é 🌊"); expect(paragraph.runs[0]!.bold).toBe(true); expect(paragraph.runs[0]!.font.rtl).toBe(true); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
