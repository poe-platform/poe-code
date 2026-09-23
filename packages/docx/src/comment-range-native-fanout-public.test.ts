import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024, 131072]) for (const route of ["model", "sdk", "cli"] as const)
it(`native comment range physical fanout reaches atomic opaque refusal; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  const seed = await api.readArchive(await textFixture("<w:p/>", {}, strict, { kind }), textContext);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const document = `<w:document xmlns:w="${word}" xmlns:o="urn:original:fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o"><w:body><w:p><w:r><w:rPr><w:i/>${"<o:leaf/>".repeat(count)}</w:rPr><w:t>Coastal anchor</w:t></w:r></w:p></w:body></w:document>`;
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ ...seed, members: seed.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(document) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const script = `import assert from 'node:assert/strict';import {Volume} from 'memfs';import * as api from 'docx';let raw='';for await(const bytes of process.stdin)raw+=bytes;const request=JSON.parse(raw),input=new Uint8Array(Buffer.from(request.input,'base64')),signal=new AbortController().signal,documentLimits={retainedBytes:2147483648,work:2147483648},context={limits:request.limits,signal,budget:new api.DocumentBudget(documentLimits,signal),timestamp:new Date('2026-03-04T05:06:07Z'),encoding:{order:'input',compression:'store'}},memory=Volume.fromJSON({'/input':Buffer.from(input),'/output':''}),ref=(resultHandle,index)=>({resultHandle,...(index===undefined?{}:{index})}),operations=[{operation:'model.document.Document.paragraphs.get',receiver:ref('document'),arguments:{},resultHandle:'paragraphs'},{operation:'model.text.paragraph.Paragraph.runs.get',receiver:ref('paragraphs',0),arguments:{},resultHandle:'runs'},{operation:'model.document.Document.add_comment.call',receiver:ref('document'),arguments:{runs:ref('runs',0),text:'Unsafe opaque note',author:''}}];
try{let code,stack;if(request.route==='model'){const doc=await api.Document(input,context),before=doc.part.package.parts.map(part=>[String(part.partname),part.blob]);try{doc.add_comment(doc.paragraphs[0].runs[0],'Unsafe opaque note','');throw Error('Opaque authoring unexpectedly admitted');}catch(error){code=error.code??error.name;stack=error.stack;}assert.deepEqual(doc.part.package.parts.map(part=>[String(part.partname),part.blob]),before);}else if(request.route==='sdk'){try{await api.executeDocumentBatch(input,{version:1,operations},{output:'-',timestamp:'2026-03-04T05:06:07Z'},{...context,stdout:{async write(bytes){memory.appendFileSync('/output',bytes);}}});throw Error('Opaque authoring unexpectedly admitted');}catch(error){code=error.code??error.name;stack=error.stack;}}else{const {Shell,MemoryFileSystem}=await import('virtual-bash'),{docxCommands}=await import('virtual-bash/commands/docx'),fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/destination',new TextEncoder().encode('Retained destination'));await fs.writeFile('/operations',new TextEncoder().encode(JSON.stringify({version:1,operations})));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits})}));try{const result=await shell.exec('docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json');assert.equal(result.exitCode,1);const data=JSON.parse(result.stdout);code=data.errors[0]?.code;assert.equal(data.affected,0);assert.deepEqual(await fs.readFile('/input'),input);assert.equal(new TextDecoder().decode(await fs.readFile('/destination')),'Retained destination');}finally{await shell.dispose();}}assert.equal(memory.statSync('/output').size,0);assert.deepEqual(new Uint8Array(memory.readFileSync('/input')),input);console.log(JSON.stringify({ok:true,code,stack,sourceRetained:true,outputBytes:0}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??error.name,stack:error.stack}));}`;
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits, route }));
  });
  const response = JSON.parse(result) as { ok: boolean; stack?: string; error?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true, code: "unsupported-edit", sourceRetained: true, outputBytes: 0 });
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
