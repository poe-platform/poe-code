import { Volume } from "memfs";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const depth of [1, 1024, 2048])
for (const operation of ["controls.repeat", "template.apply"] as const)
for (const route of ["native-sdk", "native-sdk-batch", "native-cli", "native-cli-batch"] as const)
it(`repeat/template admitted nested native table depth; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; operation=${operation}; route=${route}`, async () => {
  const api = (route.startsWith("native") ? native : source) as typeof source;
  const limits = { ...textContext.limits, maxArchiveBytes: 2097152, maxEntryBytes: 1048576, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal;
  const fresh = () => ({ signal, limits, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const });
  const field = '<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="entry"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>';
  const head = '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p/>', tail = '<w:p/></w:tc></w:tr></w:tbl>';
  const tables = head.repeat(depth) + '<w:p>' + field + '</w:p>' + tail.repeat(depth);
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><w:tag w:val="records"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${tables}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}" xmlns:f="urn:original:repeat-physical-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:pPr></w:pPr><w:r><w:t>Outside</w:t></w:r></w:p>${region}<!--retained--><?audit exact?></w:body></w:document>`));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, fresh().encoding, fresh());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const allowed = true;
  const script = `import {Volume} from 'memfs';import * as api from 'docx';import {Shell,MemoryFileSystem} from 'virtual-bash';import {docxCommands} from 'virtual-bash/commands/docx';
let source='';for await(const bytes of process.stdin)source+=bytes;const request=JSON.parse(source),input=new Uint8Array(Buffer.from(request.input,'base64')),memory=Volume.fromJSON({'/output':''}),signal=new AbortController().signal,context={limits:request.limits,signal,budget:new api.DocumentBudget(request.documentLimits,signal),encoding:{order:'input',compression:'store'},stdout:{async write(bytes){memory.appendFileSync('/output',bytes);}}},data=[{values:[{binding:'entry',value:'New 海🌊'}]}],args=request.operation==='controls.repeat'?{control:1,data}:{data},batch={version:1,operations:[{operation:request.operation,arguments:args}]};
try{if(request.route.includes('sdk')){const pending=request.route.endsWith('batch')?api.executeDocumentBatch(input,batch,{output:'-'},context):request.operation==='controls.repeat'?api.editDocumentControlRepeats(input,{control:1,data,output:'-'},context):api.applyDocumentTemplate(input,{data,output:'-'},context);if(request.allowed)await pending;else{let caught;try{await pending;}catch(error){caught=error;}if(caught?.code!=='unsupported-edit')throw caught??Error('Unsupported edit succeeded');if(memory.statSync('/output').size)throw Error('Failed SDK published');}}else{const fs=new MemoryFileSystem(),retained=new TextEncoder().encode('Retained forced destination');await fs.writeFile('/input',input);await fs.writeFile('/output',retained);await fs.writeFile('/ops',new TextEncoder().encode(JSON.stringify(batch)));await fs.writeFile('/data',new TextEncoder().encode(JSON.stringify(data)));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits:request.documentLimits})}));try{const command=request.route.endsWith('batch')?'docx batch /input --ops-file /ops':request.operation==='controls.repeat'?'docx controls repeat /input --control 1 --data-file /data':'docx template apply /input --data-file /data',response=await shell.exec(command+' --output /output --force --json'),envelope=JSON.parse(response.stdout);if(Buffer.compare(Buffer.from(await fs.readFile('/input')),Buffer.from(input)))throw Error('Input changed');if(request.allowed){if(response.exitCode)throw Error(response.stdout+response.stderr);memory.writeFileSync('/output',await fs.readFile('/output'));}else{if(response.exitCode!==1||envelope.data!==null||envelope.affected!==0||envelope.errors[0]?.code!=='unsupported-edit')throw Error(response.stdout+response.stderr);if(Buffer.compare(Buffer.from(await fs.readFile('/output')),Buffer.from(retained)))throw Error('Destination changed');}}finally{await shell.dispose();}}console.log(JSON.stringify({ok:true,output:Buffer.from(memory.readFileSync('/output')).toString('base64')}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack,code:error.code??null,outputBytes:memory.statSync('/output').size}));}`;
  const response = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), route, operation, limits, documentLimits, allowed }));
  });
  const observed = JSON.parse(response) as { ok: boolean; output?: string; error?: string; stack?: string };
  expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: true });
  memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
  if (allowed) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits); expect([...after.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
    const main = new TextDecoder(codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be").decode(after.get("word/document.xml")); expect(main.split("<w:tbl>").length - 1).toBe(depth); expect(main).toContain('<w:tblW w:w="2400" w:type="dxa"/>'); expect(main).toContain("<!--retained--><?audit exact?>");
    expect((await api.extractDocumentText(output, fresh())).text).toBe("Outside\n" + "\n".repeat(depth) + "New 海🌊" + "\n".repeat(depth));
    expect((await api.validateDocument(output, fresh())).valid).toBe(true);
    expect((await api.inspectDocumentControls(output, {}, fresh())).items.find(item => item.tag === "entry")).toMatchObject({ value: "New 海🌊", placeholder: false });
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0); expect([...readPackage(input, limits).keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of readPackage(input, limits)) expect(Buffer.compare(Buffer.from(bytes), Buffer.from(parts.get(name)!)), name).toBe(0);
});
