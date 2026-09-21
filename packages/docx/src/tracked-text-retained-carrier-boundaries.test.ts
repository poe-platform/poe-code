import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const carrier of ["choice", "fallback", "process"])
it(`tracked replacement preserves unselected hyperlink carriers; strict=${strict}; route=${route}; carrier=${carrier}`, async () => {
  const native = "<w:customXml>".repeat(64) + "<w:r><w:t>Boundary</w:t></w:r>" + "</w:customXml>".repeat(64);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const retained = carrier === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w">' + native + '</mc:Choice><mc:Fallback><f:retained/></mc:Fallback></mc:AlternateContent>' : carrier === "fallback" ? '<mc:AlternateContent><mc:Choice Requires="f"><f:retained/></mc:Choice><mc:Fallback>' + native + '</mc:Fallback></mc:AlternateContent>' : '<f:pass>' + native + '</f:pass>';
  const content = '<w:p xmlns:f="urn:original:tracked-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:t>Coast</w:t></w:r><w:hyperlink>' + retained + '</w:hyperlink></w:p>';
  const memory = Volume.fromJSON({ "/input": "" }), limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  parts.set("word/document.xml", new TextEncoder().encode('<w:document xmlns:w="' + word + '"><w:body>' + content + '</w:body></w:document>'));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const fixture = { input: new Uint8Array(memory.readFileSync("/input") as Buffer) };
  const original = (await api.extractDocumentText(fixture.input, { ...textContext, limits, budget: new api.DocumentBudget({ xmlDepth: 8192, retainedBytes: 2 ** 31, work: 2 ** 31 }) })).text;
  const script = `import {Volume} from 'memfs';import * as api from 'docx';import {Shell,MemoryFileSystem} from 'virtual-bash';import {docxCommands} from 'virtual-bash/commands/docx';
let data='';for await(const bytes of process.stdin)data+=bytes;const request=JSON.parse(data),input=new Uint8Array(Buffer.from(request.input,'base64')),memory=Volume.fromJSON({'/output':''}),sink={async write(bytes){memory.appendFileSync('/output',bytes);}},limits=request.limits,signal=new AbortController().signal,budget=()=>new api.DocumentBudget({xmlDepth:8192,retainedBytes:2**31,work:2**31},signal),context={limits,signal,budget:budget(),encoding:{order:'input',compression:'store'},stdout:sink},arguments_={find:'Coast',with:'Shore',all:true,trackChanges:true,author:'',timestamp:'2026-01-02T03:04:06Z'},ops={version:1,operations:[{operation:'text.replace',arguments:arguments_}]};
try{if(request.route==='sdk')await api.replaceDocumentText(input,{...arguments_,output:'-'},context);else if(request.route==='sdk-batch')await api.executeDocumentBatch(input,ops,{output:'-'},context);else{const fs=new MemoryFileSystem();await fs.writeFile('/input',input);const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits,documentLimits:{xmlDepth:8192,retainedBytes:2**31,work:2**31}})}));try{const command=request.route==='cli'?"docx text replace /input --find Coast --with Shore --all --track-changes --author '' --timestamp 2026-01-02T03:04:06Z --output /output --json":'docx batch /input --ops-json '+JSON.stringify(JSON.stringify(ops))+' --output /output --json';const result=await shell.exec(command);if(result.exitCode!==0){const failure=new Error(result.stdout+result.stderr);failure.code=JSON.parse(result.stdout).errors[0].code;throw failure;}memory.writeFileSync('/output',await fs.readFile('/output'));if(Buffer.compare(Buffer.from(await fs.readFile('/input')),Buffer.from(input)))throw new Error('Input changed');}finally{await shell.dispose();}}
const output=new Uint8Array(memory.readFileSync('/output')),original=await api.extractDocumentText(output,{limits,signal,budget:budget()},{view:'original'}),final=await api.extractDocumentText(output,{limits,signal,budget:budget()});console.log(JSON.stringify({ok:true,output:Buffer.from(output).toString('base64'),original:original.text,final:final.text}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??null,stack:error.stack,outputBytes:memory.statSync('/output').size}));}`;
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(fixture.input).toString("base64"), limits, route }));
  });
  const response = JSON.parse(result) as { ok: boolean; output: string; original: string; final: string; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true, original, final: original.replace("Coast", "Shore") });
  const before = readPackage(fixture.input), after = readPackage(new Uint8Array(Buffer.from(response.output, "base64")));
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(fixture.input);
  const source = new TextDecoder().decode(after.get("word/document.xml"));
  expect(source).toContain('<w:hyperlink>' + retained + '</w:hyperlink>');
});
