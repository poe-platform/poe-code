import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`rejects forbidden all cardinality for list insertion in ${carrier}; ${route}; ${kind}; strict=${strict}`, async () => {
  const first = '<w:p><w:r><w:t>Anchor 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>', second = '<w:p><w:r><w:t>Other</w:t></w:r></w:p>', p = first + second, inert = '<f:opaque f:identity="inert"/>', active = carrier === "direct" ? p + inert : carrier === "process" ? `<f:pass f:identity="carrier">${p}</f:pass>${inert}` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? p : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? p : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('', {}, strict)), ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  parts.set('word/document.xml', new TextEncoder().encode(`<w:document xmlns:w="${ns}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:list-carriers" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:body>${active}</w:body></w:document>`));
  if (kind === "dotx") parts.set('[Content_Types].xml', new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('document.main+xml','template.main+xml')));
  const memory = Volume.fromJSON({ '/input':'', '/out':'' }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync('/out',bytes); } };
  await api.writeArchive({ comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')})) }, { async write(bytes) { memory.appendFileSync('/input',bytes); } },{order:'input',compression:'store'},textContext);
  const input = new Uint8Array(memory.readFileSync('/input') as Buffer), args={all:true,kind:'upperRoman' as const,level:8,start:0,text:'Created'}, batch={version:1,operations:[{operation:'lists.add',arguments:args}]}, pub={...textContext,stdout:sink,encoding:{order:'input',compression:'store'} as const};
  if(route==='sdk')await expect(api.editDocumentLists(input,{operation:'lists.add',options:{...args,output:'-'}},pub)).rejects.toMatchObject({code:'usage'});
  else if(route==='sdk-batch')await expect(api.executeDocumentBatch(input,batch,{output:'-'},pub)).rejects.toMatchObject({code:'usage'});
  else{const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/out',new TextEncoder().encode('Original destination'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));try{const r=await shell.exec(route==='cli'?'docx lists add /input --all --kind upperRoman --level 8 --start 0 --text Created --output /out --force --json':`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --force --json`);expect(r.exitCode,r.stdout+r.stderr).toBe(2);expect(JSON.parse(r.stdout).errors[0].code).toBe('usage');expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination');expect(await fs.readFile('/input')).toEqual(input);}finally{await shell.dispose();}}
  expect(memory.readFileSync('/out').length).toBe(0);expect(new Uint8Array(memory.readFileSync('/input') as Buffer)).toEqual(input);
});
