import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { beforeAll, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const generated = new Map<string, Uint8Array>();

for (const strict of [false, true]) for (const route of ["sdk", "cli"]) for (const carrier of ["choice", "process"]) for (const depth of [32, 4096])
describe(`nested tracked carrier; strict=${strict}; route=${route}; carrier=${carrier}; depth=${depth}`, () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const selected = '<w:t>A Coast B</w:t>';
  const inactive = '<w:t>Inactive</w:t>';
  const retained = carrier === "choice" ? '<mc:Fallback>' + inactive + '</mc:Fallback>' : carrier === "fallback" ? '<mc:Choice Requires="f">' + inactive + '</mc:Choice>' : '<f:opaque>' + inactive + '</f:opaque>';
  const nested = carrier === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w">'.repeat(depth) + selected + '</mc:Choice><mc:Fallback/></mc:AlternateContent>'.repeat(depth) : '<f:pass>'.repeat(depth) + selected + '</f:pass>'.repeat(depth);
  const wrapped = carrier === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w">' + nested + '</mc:Choice>' + retained + '</mc:AlternateContent>' : carrier === "fallback" ? '<mc:AlternateContent>' + retained + '<mc:Fallback>' + nested + '</mc:Fallback></mc:AlternateContent>' : '<f:pass>' + nested + '</f:pass>' + retained;
  const content = '<w:p xmlns:f="urn:original:tracked-active-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">' + ('<w:r><w:rPr><w:b/></w:rPr>' + wrapped + '</w:r>') + '</w:p>';
  const original = "A Coast B", key = JSON.stringify([strict, route, carrier, depth]);
  const limits = { ...textContext.limits, maxArchiveBytes: 67108864, maxEntryBytes: 33554432, maxTotalBytes: 134217728, maxRetainedBytes: 2 ** 31 };
  let fixture: { input: Uint8Array; memory: Volume; parts: Map<string, Uint8Array> };
  beforeAll(async () => {
    const memory = Volume.fromJSON({ "/input": "" });
    const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
    parts.set("word/document.xml", new TextEncoder().encode('<w:document xmlns:w="' + word + '"><w:body>' + content + '</w:body></w:document>'));
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
    fixture = { input: new Uint8Array(memory.readFileSync("/input") as Buffer), memory, parts };
  });
  for (const phase of ["edit", "preservation", "baseline", "original", "final"])
  it(`tracked partial replacement retains nested active native carriers; strict=${strict}; route=${route}; carrier=${carrier}; depth=${depth}; phase=${phase}`, async () => {
  const { memory } = fixture;
  const script = `import {Volume} from 'memfs';import * as api from 'docx';
let data='';for await(const bytes of process.stdin)data+=bytes;const request=JSON.parse(data),input=new Uint8Array(Buffer.from(request.input,'base64')),memory=Volume.fromJSON({'/output':''}),sink={async write(bytes){memory.appendFileSync('/output',bytes);}},limits=request.limits,signal=new AbortController().signal,budget=()=>new api.DocumentBudget({xmlDepth:16384,retainedBytes:2**31,work:2**31},signal),context={limits,signal,budget:budget(),encoding:{order:'input',compression:'store'},stdout:sink},arguments_={find:'Coast',with:'Shore',all:true,bold:false,italic:true,trackChanges:true,author:'',timestamp:'2026-01-02T03:04:06Z'},ops={version:1,operations:[{operation:'text.replace',arguments:arguments_}]};
try{if(request.phase!=='edit'){const data=await api.extractDocumentText(input,{limits,signal,budget:budget()},{view:request.phase==='baseline'?'final':request.phase});console.log(JSON.stringify({ok:true,text:data.text,outputBytes:memory.statSync('/output').size}));}else{if(request.route==='sdk')await api.replaceDocumentText(input,{...arguments_,output:'-'},context);else if(request.route==='sdk-batch')await api.executeDocumentBatch(input,ops,{output:'-'},context);else{const {Shell,MemoryFileSystem}=await import('@poe-platform/safe-bash');const {docxCommands}=await import('@poe-platform/safe-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits,documentLimits:{xmlDepth:16384,retainedBytes:2**31,work:2**31}})}));try{const command=request.route==='cli'?"docx text replace /input --find Coast --with Shore --all --bold false --italic true --track-changes --author '' --timestamp 2026-01-02T03:04:06Z --output /output --json":'docx batch /input --ops-json '+JSON.stringify(JSON.stringify(ops))+' --output /output --json';const result=await shell.exec(command);if(result.exitCode!==0){const failure=new Error(result.stdout+result.stderr);failure.code=JSON.parse(result.stdout).errors[0].code;throw failure;}memory.writeFileSync('/output',await fs.readFile('/output'));if(Buffer.compare(Buffer.from(await fs.readFile('/input')),Buffer.from(input)))throw new Error('Input changed');}finally{await shell.dispose();}}
const output=new Uint8Array(memory.readFileSync('/output'));console.log(JSON.stringify({ok:true,output:Buffer.from(output).toString('base64')}));}}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??null,stack:error.stack,outputBytes:memory.statSync('/output').size}));}`;
  if (phase === "preservation" || phase === "original" || phase === "final") expect(generated.has(key), "The independently asserted edit must have produced its candidate.").toBe(true);
  const result = phase === "preservation" ? JSON.stringify({ ok: true, output: Buffer.from(generated.get(key)!).toString("base64") }) : await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(phase === "original" || phase === "final" ? generated.get(key)! : fixture.input).toString("base64"), limits, route, phase }));
  });
  const response = JSON.parse(result) as { ok: boolean; output: string; text: string; outputBytes: number; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true });
  if (phase !== "edit" && phase !== "preservation") {
    expect(response).toMatchObject({ text: phase === "final" ? original.replace("Coast", "Shore") : original, outputBytes: 0 });
    expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(fixture.input);
    return;
  }
  if (phase === "edit") {
    generated.set(key, new Uint8Array(Buffer.from(response.output, "base64")));
    return;
  }
  const observe = async (bytes: Uint8Array) => new Map((await api.readArchive(bytes, {
    ...textContext, limits,
    budget: new api.DocumentBudget({ retainedBytes: 2 ** 31, work: 2 ** 31 }, textContext.signal, () => new Promise(resolve => setImmediate(resolve)))
  })).members.map(member => [member.name, member.bytes]));
  const before = fixture.parts, after = await observe(new Uint8Array(Buffer.from(response.output, "base64")));
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(fixture.input);
  const source = new TextDecoder().decode(after.get("word/document.xml"));
  expect(source).toContain(retained);
  });
});
