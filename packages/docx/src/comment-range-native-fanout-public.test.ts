import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { Volume } from "memfs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const script = `import assert from 'node:assert/strict';import {Volume} from 'memfs';import * as api from 'docx';import {createInterface} from 'node:readline';import {Shell,MemoryFileSystem} from '@poe-platform/safe-bash';import {docxCommands} from '@poe-platform/safe-bash/commands/docx';console.log(JSON.stringify({ready:true}));for await(const raw of createInterface({input:process.stdin})){const request=JSON.parse(raw),input=new Uint8Array(Buffer.from(request.input,'base64')),signal=new AbortController().signal,documentLimits={retainedBytes:2147483648,work:2147483648},context={limits:request.limits,signal,budget:new api.DocumentBudget(documentLimits,signal,async()=>{}),timestamp:new Date('2026-03-04T05:06:07Z'),encoding:{order:'input',compression:'store'}},memory=Volume.fromJSON({'/input':Buffer.from(input),'/output':''}),ref=(resultHandle,index)=>({resultHandle,...(index===undefined?{}:{index})}),operations=[{operation:'model.document.Document.paragraphs.get',receiver:ref('document'),arguments:{},resultHandle:'paragraphs'},{operation:'model.text.paragraph.Paragraph.runs.get',receiver:ref('paragraphs',0),arguments:{},resultHandle:'runs'},{operation:'model.document.Document.add_comment.call',receiver:ref('document'),arguments:{runs:ref('runs',0),text:'Unsafe opaque note',author:''}}];
try{let code,stack;if(request.route==='model'){const doc=await api.Document(input,context),before=doc.part.package.parts.map(part=>[String(part.partname),part.blob]);try{doc.add_comment(doc.paragraphs[0].runs[0],'Unsafe opaque note','');throw Error('Opaque authoring unexpectedly admitted');}catch(error){code=error.code??error.name;stack=error.stack;}assert.deepEqual(doc.part.package.parts.map(part=>[String(part.partname),part.blob]),before);}else if(request.route==='sdk'){try{await api.executeDocumentBatch(input,{version:1,operations},{output:'-',timestamp:'2026-03-04T05:06:07Z'},{...context,stdout:{async write(bytes){memory.appendFileSync('/output',bytes);}}});throw Error('Opaque authoring unexpectedly admitted');}catch(error){code=error.code??error.name;stack=error.stack;}}else{const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/destination',new TextEncoder().encode('Retained destination'));await fs.writeFile('/operations',new TextEncoder().encode(JSON.stringify({version:1,operations})));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits})}));try{const result=await shell.exec('docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json');assert.equal(result.exitCode,1);const data=JSON.parse(result.stdout);code=data.errors[0]?.code;assert.equal(data.affected,0);assert.deepEqual(await fs.readFile('/input'),input);assert.equal(new TextDecoder().decode(await fs.readFile('/destination')),'Retained destination');}finally{await shell.dispose();}}assert.equal(memory.statSync('/output').size,0);assert.deepEqual(new Uint8Array(memory.readFileSync('/input')),input);console.log(JSON.stringify({ok:true,code,stack,sourceRetained:true,outputBytes:0}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??error.name,stack:error.stack}));}}`;

let child: ChildProcessWithoutNullStreams;
let replies: AsyncIterator<string>;
let completed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
let stderr = "";
let requestPending = false;

beforeAll(async () => {
  child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  completed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  child.stderr.on("data", bytes => { stderr += String(bytes); });
  child.on("error", error => { stderr += String(error); });
  child.stdin.on("error", error => { stderr += String(error); });
  replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ready = await replies.next();
  assert.equal(ready.done, false, stderr);
  assert.deepEqual(JSON.parse(ready.value), { ready: true });
});

afterEach(() => {
  if (requestPending) child.kill();
});

afterAll(async () => {
  child.stdin.end();
  assert.deepEqual(await completed, { code: 0, signal: null }, stderr);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024, 131072]) for (const route of ["model", "sdk", "cli"] as const)
describe(`native comment range physical fanout reaches atomic opaque refusal; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  let limits: typeof textContext.limits;
  let memory: ReturnType<typeof Volume.fromJSON>;
  let input: Uint8Array;
  beforeEach(async () => {
    const seed = await api.readArchive(await textFixture("<w:p/>", {}, strict, { kind }), textContext);
    const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const document = `<w:document xmlns:w="${word}" xmlns:o="urn:original:fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o"><w:body><w:p><w:r><w:rPr><w:i/>${"<o:leaf/>".repeat(count)}</w:rPr><w:t>Coastal anchor</w:t></w:r></w:p></w:body></w:document>`;
    limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
    memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ ...seed, members: seed.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(document) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
    input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  });
  it("rejects atomically through the native public command", async () => {
  requestPending = true;
  await new Promise<void>((resolve, reject) => {
    child.stdin.write(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits, route }) + "\n", error => error ? reject(error) : resolve());
  });
  const reply = await replies.next();
  requestPending = false;
  assert.equal(reply.done, false, stderr);
  const result = reply.value;
  const response = JSON.parse(result) as { ok: boolean; stack?: string; error?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true, code: "unsupported-edit", sourceRetained: true, outputBytes: 0 });
  assert.deepEqual(new Uint8Array(memory.readFileSync("/input") as Buffer), input);
  });
});
