import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, paragraph } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false,true]) for (const kind of ["docx","dotx"] as const)
for (const spelling of ["w","alternate","default"] as const)
for (const carrier of ["direct","choice","fallback","process"] as const)
for (const placement of ["defaults","container"] as const)
for (const property of ["font","indent"] as const)
for (const action of ["patch","unchanged"] as const)
for (const route of ["sdk-direct","sdk-batch","cli-direct","cli-batch"] as const)
it(`${route} rejects ambiguous ${placement} ${property} ${action} ${carrier} ${spelling} ${kind} strict=${strict}`, async()=>{
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", known = spelling === "default" ? "w" : spelling;
  const prop = property === "font" ? "rPr" : "pPr", container = property === "font" ? "rPrDefault" : "pPrDefault";
  const leaf = property === "font" ? '<w:rFonts w:ascii="Original" w:hAnsi="Original"/>' : `<w:ind w:${strict?"start":"left"}="720"/>`;
  const owner = `<w:${container}><w:${prop}>${leaf}</w:${prop}></w:${container}>`;
  const defaults = `<w:docDefaults>${owner}${placement === "container" ? owner : ""}</w:docDefaults>`;
  const active = defaults + (placement === "defaults" ? defaults : "");
  const wrapped = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? known : "f"}">${carrier === "choice" ? active : '<f:opaque f:identity="retained"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : '<f:opaque f:identity="retained"/>'}</mc:Fallback></mc:AlternateContent>`;
  const raw = `<w:styles xmlns:w="${w}" xmlns:f="urn:original:default-ambiguity" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${wrapped}<!--retain--><?policy keep?></w:styles>`;
  const source = spelling === "default" ? raw.split("<w:").join("<").split("</w:").join("</").replace("<styles ", `<styles xmlns="${w}" `) : raw.replace("xmlns:w=", `xmlns:${spelling}=`).split("w:").join(`${spelling}:`);
  const parts = readPackage(await textFixture(paragraph("Retain 日本 עברית é 🌊"),{styles:{kind:"styles",xml:source}},strict));
  if(kind === "dotx") parts.set("[Content_Types].xml",encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml","wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input":"","/output":"retained"});
  await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), args = property === "font" ? {font:action === "patch" ? "Changed Latin" : "Original"} : {leftIndent:{value:action === "patch" ? 72 : 36,unit:"pt" as const}}, batch = {version:1,operations:[{operation:"styles.defaults.set",arguments:args}]};
  const pub = {...textContext,encoding:{order:"input" as const,compression:"store" as const},stdout:{async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}}};
  if(route === "sdk-direct") await expect(api.editDocumentStyles(input,{operation:"styles.defaults.set",...args,output:"-"},pub)).rejects.toMatchObject({code:"unsupported-edit"});
  else if(route === "sdk-batch") await expect(api.executeDocumentBatch(input,batch,{output:"-"},pub)).rejects.toMatchObject({code:"unsupported-edit"});
  else {const fs = new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/output",encode("retained"));const shell = new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));
    try {const flags = property === "font" ? `--font '${args.font}'` : `--left-indent ${action === "patch" ? "72pt" : "36pt"}`,command = route === "cli-direct" ? `docx styles defaults set /input ${flags} --output /output --force --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /output --force --json`,r = await shell.exec(command);expect(r.exitCode,r.stdout+r.stderr).toBe(1);const result = JSON.parse(r.stdout);expect(result.errors[0].code).toBe("unsupported-edit");expect(result.affected).toBe(0);expect(result.data).toBe(null);expect(await fs.readFile("/output")).toEqual(encode("retained"));expect(await fs.readFile("/input")).toEqual(input);}finally{await shell.dispose();}}
  expect(memory.readFileSync("/output","utf8")).toBe("retained");expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
