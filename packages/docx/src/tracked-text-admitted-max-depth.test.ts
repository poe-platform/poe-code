import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const scenario of ["properties", "hyperlink"]) for (const observedView of ["original", "final", "baseline"])
it(`tracked replacement respects admitted depth7800 retained boundaries; strict=${strict}; route=${route}; scenario=${scenario}${observedView === "original" ? "" : "; observedView=" + observedView}`, async () => {
  const foreign = "<f:unknown>".repeat(7800) + "<f:value/>" + "</f:unknown>".repeat(7800);
  const native = "<w:customXml>".repeat(7800) + "<w:r><w:t>Boundary</w:t></w:r>" + "</w:customXml>".repeat(7800);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const content = '<w:p xmlns:f="urn:original:tracked-boundary" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">' + (scenario === "properties" ? '<w:pPr>' + foreign + '</w:pPr>' : '') + '<w:r><w:t>Coast</w:t>' + (scenario === "run-opaque" ? foreign : '') + '</w:r>' + (scenario === "hyperlink" ? '<w:hyperlink>' + native + '</w:hyperlink>' : '') + '</w:p>';
  const memory = Volume.fromJSON({ "/input": "" }), limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  parts.set("word/document.xml", new TextEncoder().encode('<w:document xmlns:w="' + word + '"><w:body>' + content + '</w:body></w:document>'));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const fixture = { input: new Uint8Array(memory.readFileSync("/input") as Buffer) };
  const original = scenario === "hyperlink" ? "CoastBoundary" : "Coast";
  const script = `import assert from 'node:assert/strict';import {Volume} from 'memfs';import * as api from 'docx';
let data='';for await(const bytes of process.stdin)data+=bytes;const request=JSON.parse(data),input=new Uint8Array(Buffer.from(request.input,'base64')),memory=Volume.fromJSON({'/output':''}),sink={async write(bytes){memory.appendFileSync('/output',bytes);}},limits=request.limits,signal=new AbortController().signal,budget=()=>new api.DocumentBudget({xmlDepth:8192,retainedBytes:2**31,work:2**31},signal),context={limits,signal,budget:budget(),encoding:{order:'input',compression:'store'},stdout:sink},arguments_={find:'Coast',with:'Shore',all:true,trackChanges:true,author:'',timestamp:'2026-01-02T03:04:06Z'},ops={version:1,operations:[{operation:'text.replace',arguments:arguments_}]};
try{if(request.observedView==='baseline'){const beforeText=(await api.extractDocumentText(input,{limits,signal,budget:budget()})).text;console.log(JSON.stringify({ok:true,beforeText,outputBytes:memory.statSync('/output').size}));process.exit(0);}if(request.route==='sdk')await api.replaceDocumentText(input,{...arguments_,output:'-'},context);else if(request.route==='sdk-batch')await api.executeDocumentBatch(input,ops,{output:'-'},context);else{const {Shell,MemoryFileSystem}=await import('@poe-platform/safe-bash');const {docxCommands}=await import('@poe-platform/safe-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits,documentLimits:{xmlDepth:8192,retainedBytes:2**31,work:2**31}})}));try{const command=request.route==='cli'?"docx text replace /input --find Coast --with Shore --all --track-changes --author '' --timestamp 2026-01-02T03:04:06Z --output /output --json":'docx batch /input --ops-json '+JSON.stringify(JSON.stringify(ops))+' --output /output --json';const result=await shell.exec(command);if(result.exitCode!==0){const failure=new Error(result.stdout+result.stderr);failure.code=JSON.parse(result.stdout).errors[0].code;throw failure;}memory.writeFileSync('/output',await fs.readFile('/output'));if(Buffer.compare(Buffer.from(await fs.readFile('/input')),Buffer.from(input)))throw new Error('Input changed');}finally{await shell.dispose();}}
const output=new Uint8Array(memory.readFileSync('/output')),observed=await api.extractDocumentText(output,{limits,signal,budget:budget()},{view:request.observedView});const beforeArchive=await api.readArchive(input,{limits,signal,budget:budget()}),afterArchive=await api.readArchive(output,{limits,signal,budget:budget()});assert.deepEqual(afterArchive.members.map(m=>m.name),beforeArchive.members.map(m=>m.name));for(let n=0;n<beforeArchive.members.length;n++){const before=beforeArchive.members[n],after=afterArchive.members[n];if(before.name!=='word/document.xml')assert.deepEqual(after.bytes,before.bytes);}const source=new TextDecoder().decode(afterArchive.members.find(m=>m.name==='word/document.xml').bytes);assert.ok(source.includes(request.retained));console.log(JSON.stringify({ok:true,view:request.observedView,text:observed.text,exactMemberOrderNondirtyPartsAndRetainedSource:true}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??null,stack:error.stack,outputBytes:memory.statSync('/output').size}));}`;
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(fixture.input).toString("base64"), limits, route, observedView, retained: scenario === "properties" ? "<w:pPr>" + foreign + "</w:pPr>" : "<w:hyperlink>" + native + "</w:hyperlink>" }));
  });
  const response = JSON.parse(result) as { ok: boolean; output: string; original: string; final: string; error?: string; stack?: string };
  if (observedView === "baseline") expect(response, response.stack ?? response.error).toMatchObject({ ok: true, beforeText: original, outputBytes: 0 });
  else expect(response, response.stack ?? response.error).toMatchObject({ ok: true, view: observedView, text: observedView === "original" ? original : original.replace("Coast", "Shore"), exactMemberOrderNondirtyPartsAndRetainedSource: true });
  expect(Buffer.compare(Buffer.from(memory.readFileSync("/input") as Buffer), Buffer.from(fixture.input))).toBe(0);
});
