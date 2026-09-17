import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, validateDocument, inspectDocument, editDocumentParagraphs, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["main", "header", "custom"] as const) for (const carrier of ["direct", "choice", "process"] as const)
for (const parameter of ["", ";audit=relationships+xml", '; audit="coast; relationships+xml"'])
for (const edge of ["valid", "missing", "wrong"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} validates ${owner} ${carrier} reference=${edge} MIME=${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", enc = (text: string) => new TextEncoder().encode(text), dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const link = '<w:hyperlink r:id="linked"><w:r><w:t>Inert external label</w:t></w:r></w:hyperlink>', retained = '<w:hyperlink r:id="inactive"><w:r><w:t>Unselected label</w:t></w:r></w:hyperlink>';
  const content = carrier === "direct" ? link : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${link}</mc:Choice><mc:Fallback>${retained}</mc:Fallback></mc:AlternateContent>` : `<f:carrier>${link}</f:carrier>`;
  const paragraph = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">${content}<!--retained--><?audit original?></w:p>`;
  const part = owner === "main" ? "/word/document.xml" : owner === "header" ? "/audit/header.xml" : "/audit/custom.xml", partType = owner === "main" ? `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml` : owner === "header" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" : "application/xml";
  const parts = readPackage(await chartFixture({strict, definitions: [], body: '<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>' + (owner === "main" ? paragraph : owner === "header" ? '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>' : ''), resources: owner === "main" ? [] : [{name: part.slice(1), type: partType+parameter, bytes: `<${owner === "header" ? "w:hdr" : "audit"} xmlns:w="${w}" xmlns:r="${r}">${paragraph}</${owner === "header" ? "w:hdr" : "audit"}>`}], relationships: [
    ...(owner === "main" ? [] : [{owner: "/word/document.xml", id: owner, type: owner === "header" ? r+"/header" : "urn:original:custom", target: part}]),
    ...(edge === "missing" ? [] : [{owner: part, id: "linked", type: edge === "valid" ? r+"/hyperlink" : "urn:original:unrelated", target: "https://example.invalid/never-fetch", external: true}])
  ]}));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace(`ContentType="${partType}"`, `ContentType="${(partType+parameter).replaceAll('"','&quot;')}"`)));
  const memory = Volume.fromJSON({"/input":"","/output":""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), valid = edge === "valid" || owner === "custom";
  if (route === "model") {
    const model = await Document(input,chartContext); model.paragraphs[0]!.text = "Changed body"; const task = model.save(sink); if (!valid) await expect(task).rejects.toMatchObject({code:"invalid-package"}); else await task;
  } else if (route === "sdk") {
    const inspected = await inspectDocument(input,chartContext); expect(inspected.parts.find(row=>row.name===part)!.contentType).toBe(partType+parameter);
    const report=await validateDocument(input,chartContext);expect(report.valid,JSON.stringify(report.diagnostics)).toBe(valid); if(!valid)expect(report.diagnostics.some(row=>row.code===(edge==="missing"?"relationship-reference":"relationship-type"))).toBe(true);
    const task=editDocumentParagraphs(input,{operation:"paragraphs.set",options:{paragraph:1,text:"Changed body",output:"-"}},{...chartContext,encoding:{order:"input",compression:"store"},stdout:sink});if(!valid)await expect(task).rejects.toMatchObject({code:"invalid-package"});else await task;
  } else {
    const fs=new MemoryFileSystem();await fs.writeFile("/input",input);const shell=new Shell({fs}).use(docxCommands({engine:createDocxInspectionCommandEngine({limits:chartContext.limits})}));
    const checked=await shell.exec("docx validate /input --json");expect(checked.exitCode,checked.stderr+checked.stdout).toBe(valid?0:1);const envelope=JSON.parse(checked.stdout);if(valid)expect(envelope.data.valid).toBe(true);else{expect(envelope).toMatchObject({ok:false,data:null});expect(envelope.errors.some((row:{code:string;part:string})=>row.code==="invalid-package"&&row.part===part)).toBe(true);}
    const edited=await shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed body' --output - > /output");if(!valid){expect(edited.exitCode).not.toBe(0);expect(edited.stderr).toContain("invalid-package");}else expect(edited.exitCode,edited.stderr).toBe(0);memory.writeFileSync("/output",await fs.readFile("/output"));expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));if(!valid){expect(memory.readFileSync("/output").length).toBe(0);return;}
  const output=new Uint8Array(memory.readFileSync("/output") as Buffer), saved=readPackage(output);for(const[name,bytes]of parts)if(name!=="word/document.xml")expect(saved.get(name),name).toEqual(bytes);expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());if(owner==="main")expect(dec(saved.get("word/document.xml")!)).toContain(paragraph);expect((await Document(output,chartContext)).paragraphs[0]!.text).toBe("Changed body");expect((await validateDocument(output,chartContext)).valid).toBe(true);
});
