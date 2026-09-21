import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const lowered of [false, true])
it(`native control text inspection retains admitted depth4096; strict=${strict}; kind=${kind}; route=${route}; lowered=${lowered}`, async () => {
  const parts = readPackage(await textFixture("<w:p/>", {}, strict, { kind }));
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const nested = "<w:customXml>".repeat(4096) + '<w:r><w:t>海岸😀</w:t><w:tab/><w:t>East</w:t><w:br/><w:t>West</w:t></w:r>' + "</w:customXml>".repeat(4096);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}"><w:body><w:sdt><w:sdtPr><w:id w:val="31"/><w:tag w:val="coast"/><w:alias w:val="Native coast"/><w:text/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:p>${nested}</w:p><w:p><w:r><w:t>South</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "" });
  const limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const script = `import assert from 'node:assert/strict';import {Volume} from 'memfs';import * as api from 'docx';
let data='';for await(const bytes of process.stdin)data+=bytes;const request=JSON.parse(data),input=new Uint8Array(Buffer.from(request.input,'base64')),saved=input.slice(),signal=new AbortController().signal,documentLimits={xmlDepth:request.lowered?4096:8192},context={limits:request.limits,signal,budget:new api.DocumentBudget(documentLimits,signal)},ops={version:1,operations:[{operation:'controls.list',arguments:{}}]};
try{let items;if(request.route==='sdk')items=(await api.inspectDocumentControls(input,{},context)).items;else if(request.route==='sdk-batch')items=(await api.executeDocumentBatch(input,ops,{},context)).results[0].data.items;else{const {Shell,MemoryFileSystem}=await import('virtual-bash');const {docxCommands}=await import('virtual-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/sentinel',new TextEncoder().encode('unchanged'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits})}));try{const command=request.route==='cli'?'docx controls list /input --json':'docx batch /input --ops-json '+JSON.stringify(JSON.stringify(ops))+' --json';const result=await shell.exec(command);assert.deepEqual(await fs.readFile('/input'),input);assert.equal(new TextDecoder().decode(await fs.readFile('/sentinel')),'unchanged');const parsed=JSON.parse(result.stdout);if(result.exitCode!==0){const error=new Error(result.stdout+result.stderr);error.code=parsed.errors[0].code;throw error;}items=request.route==='cli'?parsed.data.items:parsed.data.results[0].data.items;}finally{await shell.dispose();}}assert.deepEqual(input,saved);assert.equal(items.length,1);assert.equal(items[0].value,'海岸😀\\tEast\\nWest\\nSouth');assert.equal(items[0].id,'31');assert.equal(items[0].tag,'coast');assert.equal(items[0].alias,'Native coast');assert.equal(items[0].kind,'plain-text');assert.equal(items[0].support,'supported');assert.equal(items[0].placeholder,true);assert.equal(items[0].lock,'unlocked');assert.deepEqual(items[0].choices,[]);assert.equal(items[0].binding,null);console.log(JSON.stringify({ok:true,exactTextMetadataAndSource:true}));}catch(error){assert.deepEqual(input,saved);console.log(JSON.stringify({ok:false,code:error.code??null,error:String(error),stack:error.stack}));}`;
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits, route, lowered }));
  });
  const response = JSON.parse(result) as { ok: boolean; code?: string; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject(lowered ? { ok: false, code: "limit-exceeded" } : { ok: true, exactTextMetadataAndSource: true });
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
