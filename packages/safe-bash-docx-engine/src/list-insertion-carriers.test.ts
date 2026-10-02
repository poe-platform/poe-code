import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`inserts list beside native paragraph in ${carrier}; ${route}; ${kind}; strict=${strict}`, async () => {
  const p = '<w:p><w:r><w:t>Anchor 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>', inert = '<f:opaque f:identity="inert"/>', active = carrier === "direct" ? p + inert : carrier === "process" ? `<f:pass f:identity="carrier">${p}</f:pass>${inert}` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? p : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? p : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('', {}, strict)), ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  parts.set('word/document.xml', new TextEncoder().encode(`<w:document xmlns:w="${ns}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:list-carriers" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:body>${active}</w:body></w:document>`));
  if (kind === "dotx") parts.set('[Content_Types].xml', new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('document.main+xml','template.main+xml')));
  const memory = Volume.fromJSON({ '/input':'', '/out':'' }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync('/out',bytes); } };
  await api.writeArchive({ comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')})) }, { async write(bytes) { memory.appendFileSync('/input',bytes); } },{order:'input',compression:'store'},textContext);
  const input = new Uint8Array(memory.readFileSync('/input') as Buffer), args={paragraph:1,kind:'upperRoman' as const,level:8,start:0,text:'Created'}, batch={version:1,operations:[{operation:'lists.add',arguments:args}]}, pub={...textContext,stdout:sink,encoding:{order:'input',compression:'store'} as const};
  if(route==='sdk')await api.editDocumentLists(input,{operation:'lists.add',options:{...args,output:'-'}},pub);
  else if(route==='sdk-batch')await api.executeDocumentBatch(input,batch,{output:'-'},pub);
  else{const fs=new MemoryFileSystem();await fs.writeFile('/input',input);const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));try{const r=await shell.exec(route==='cli'?'docx lists add /input --paragraph 1 --kind upperRoman --level 8 --start 0 --text Created --output /out --json':`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --json`);expect(r.exitCode,r.stdout+r.stderr).toBe(0);memory.writeFileSync('/out',await fs.readFile('/out'));expect(await fs.readFile('/input')).toEqual(input);}finally{await shell.dispose();}}
  const output=new Uint8Array(memory.readFileSync('/out') as Buffer),saved=readPackage(output);assertPackageLinks(saved);for(const[name,bytes]of parts)if(!['word/document.xml','word/_rels/document.xml.rels','[Content_Types].xml'].includes(name))expect(saved.get(name),name).toEqual(bytes);
  const d=await api.Document(output,textContext);expect(d.paragraphs.map(p=>p.text)).toEqual(['Anchor 日本 עברית é 🌊','Created']);const xml=new TextDecoder().decode(saved.get('word/document.xml'));expect(xml).toContain(p);expect(xml).toContain(inert);if(carrier==='process')expect(xml).toContain('f:identity="carrier"');
});
