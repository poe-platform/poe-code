import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const depth of [32, 4096]) for (const route of ["snapshot", "resource", "cli"] as const)
it(`native settings inventory retains admitted inert depth; strict=${strict}; kind=${kind}; depth=${depth}; route=${route}`, async () => {
  const input = await textFixture("<w:p/>", { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><!--retained--><w:compat>${"<w:x>".repeat(depth)}<w:leaf w:stored="Native coast"/>${"</w:x>".repeat(depth)}</w:compat><?audit original?></w:settings>` } }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const script = `import assert from 'node:assert/strict';import {Volume} from 'memfs';import * as api from 'docx';
let raw='';for await(const bytes of process.stdin)raw+=bytes;const request=JSON.parse(raw),input=new Uint8Array(Buffer.from(request.input,'base64')),signal=new AbortController().signal,documentLimits={xmlDepth:8192,retainedBytes:1073741824,serializedOutput:67108864,work:1073741824},context={limits:request.limits,signal,budget:new api.DocumentBudget(documentLimits,signal)},memory=Volume.fromJSON({'/input':Buffer.from(input),'/output':''});
try{let entries,properties;if(request.route==='cli'){const {Shell,MemoryFileSystem}=await import('virtual-bash'),{docxCommands}=await import('virtual-bash/commands/docx'),fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/destination',new TextEncoder().encode('Retained destination'));const shell=new Shell({fs,limits:{maxOutputBytes:67108864}}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits})}));try{const result=await shell.exec('docx settings list /input --json');assert.equal(result.exitCode,0,result.stderr);properties=JSON.parse(result.stdout).data.items[0].properties;assert.deepEqual(await fs.readFile('/input'),input);assert.equal(new TextDecoder().decode(await fs.readFile('/destination')),'Retained destination');}finally{await shell.dispose();}}else if(request.route==='snapshot')entries=(await api.inspectDocumentSettings(input,{},context)).items[0].details.entries;else properties=(await api.inspectDocumentSettings(input,{},context,'resource')).items[0].properties;
const path=Array(request.depth+2).fill(0);if(entries){assert.equal(entries.length,request.depth+2);assert.deepEqual(entries.at(-1).path,path);assert.equal(entries.at(-1).localName,'leaf');assert.deepEqual(entries.at(-1).attributes.map(a=>[a.localName,a.value]),[['stored','Native coast']]);}else{assert.equal(properties.find(p=>p.name==='entryCount').value,request.depth+2);assert.equal(properties.find(p=>p.name==='settings['+path.join('.')+'].localName').value,'leaf');assert.equal(properties.find(p=>p.name==='settings['+path.join('.')+'].attributes[0].value').value,'Native coast');}assert.deepEqual(new Uint8Array(memory.readFileSync('/input')),input);assert.equal(memory.statSync('/output').size,0);console.log(JSON.stringify({ok:true,count:request.depth+2,sourceRetained:true,outputBytes:0}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??null,stack:error.stack}));}`;
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits: textContext.limits, depth, route }));
  });
  const response = JSON.parse(result) as { ok: boolean; stack?: string; error?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true, count: depth + 2, sourceRetained: true, outputBytes: 0 });
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
