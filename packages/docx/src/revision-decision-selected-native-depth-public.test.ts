import { Volume } from "memfs";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const depth of [32, 8192]) for (const action of ["accept", "reject"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`revision decision retains selected admitted native property depth; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; action=${action}; route=${route}`, async () => {
  const product: typeof api = route.startsWith("native") ? native as unknown as typeof api : api;
  const limits = { ...textContext.limits, maxArchiveBytes: 2097152, maxEntryBytes: 1048576, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 };
  const signal = new AbortController().signal;
  const fresh = () => ({ limits, signal, budget: new product.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const });
  const retained = '<w:rPr>' + '<w:futureProperty>'.repeat(depth) + '<w:leaf/>' + '</w:futureProperty>'.repeat(depth) + '</w:rPr>';
  const body = `<w:p xmlns:f="urn:original:revision-unrelated-property-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:ins w:id="7" w:author="Stored"><w:r>${retained}<w:t>Inserted海🌊</w:t></w:r></w:ins><w:r><w:t>Outside</w:t></w:r></w:p>`;
  const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`));
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, fresh().encoding, fresh());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const operation = `revisions.${action}` as const, arguments_ = { revision: 1 }, batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
  if (route.startsWith("native")) {
    const script = `import {Volume} from 'memfs';import * as api from 'docx';import {Shell,MemoryFileSystem} from 'virtual-bash';import {docxCommands} from 'virtual-bash/commands/docx';
let source='';for await(const bytes of process.stdin)source+=bytes;const request=JSON.parse(source),input=new Uint8Array(Buffer.from(request.input,'base64')),memory=Volume.fromJSON({'/output':''}),signal=new AbortController().signal,context={limits:request.limits,signal,budget:new api.DocumentBudget(request.documentLimits,signal),encoding:{order:'input',compression:'store'},stdout:{async write(bytes){memory.appendFileSync('/output',bytes);}}},batch={version:1,operations:[{operation:request.operation,arguments:{revision:1}}]};
try{let result;if(request.route.includes('sdk'))result=request.route.endsWith('batch')?(await api.executeDocumentBatch(input,batch,{output:'-'},context)).results[0].data:await api.editDocumentRevisionDecisions(input,{operation:request.operation,options:{revision:1,output:'-'}},context);else{const fs=new MemoryFileSystem(),retained=new TextEncoder().encode('Retained forced destination');await fs.writeFile('/input',input);await fs.writeFile('/output',retained);await fs.writeFile('/ops',new TextEncoder().encode(JSON.stringify(batch)));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits:request.documentLimits})}));try{const response=await shell.exec((request.route.endsWith('batch')?'docx batch /input --ops-file /ops':'docx '+request.operation.split('.').join(' ')+' /input --revision 1')+' --output /output --force --json');if(Buffer.compare(Buffer.from(await fs.readFile('/input')),Buffer.from(input)))throw Error('Input changed');if(response.exitCode){if(Buffer.compare(Buffer.from(await fs.readFile('/output')),Buffer.from(retained)))throw Error('Destination changed');throw Error(response.stdout+response.stderr);}const envelope=JSON.parse(response.stdout);result=request.route.endsWith('batch')?envelope.data.results[0].data:envelope.data;memory.writeFileSync('/output',await fs.readFile('/output'));}finally{await shell.dispose();}}console.log(JSON.stringify({ok:true,result,output:Buffer.from(memory.readFileSync('/output')).toString('base64')}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack,code:error.code??null,outputBytes:memory.statSync('/output').size}));}`;
    const response = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
      child.on("error", reject); child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
      child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), route, operation, limits, documentLimits }));
    });
    const observed = JSON.parse(response) as { ok: boolean; output?: string; result?: unknown; error?: string; stack?: string };
    expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: true, result: { changed: true, changes: [{ revision: { id: "7", type: "insert" } }] } });
    memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
  } else if (route.includes("sdk")) {
    const io = { ...fresh(), stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const result = route.endsWith("batch") ? (await product.executeDocumentBatch(input, batch, { output: "-" }, io)).results[0]!.data : await product.editDocumentRevisionDecisions(input, { operation, options: { ...arguments_, output: "-" } }, io);
    expect(result).toMatchObject({ changed: true, changes: [{ revision: { id: "7", type: "insert" } }] });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained forced destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops" : `docx revisions ${action} /input --revision 1`) + " --output /output --force --json");
      expect(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(original))).toBe(0);
      if (response.exitCode !== 0) expect(Buffer.compare(Buffer.from(await fs.readFile("/output")), Buffer.from(destination))).toBe(0);
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      expect(JSON.parse(response.stdout)).toMatchObject({ ok: true, errors: [] });
      memory.writeFileSync("/output", await fs.readFile("/output"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
  expect([...after.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
  const xml = await product.getDocumentXml(output, fresh(), { part: "/word/document.xml", raw: true }) as Uint8Array;
  const parsed = await product.parseDocumentXmlAsync(xml, { maxDepth: 16384 }, new product.DocumentBudget(documentLimits, signal));
  if (action === "accept") expect(parsed.root.children[0]!.children[0]!.children[0]!.children[0]!.localName).toBe("rPr");
  const decoded = codec === "utf8" ? new TextDecoder().decode(xml) : new TextDecoder(codec === "utf16le" ? "utf-16le" : "utf-16be").decode(xml);
  if (action === "accept") expect(decoded).toContain(retained); else expect(decoded).not.toContain(retained);
  expect((await product.extractDocumentText(output, fresh())).text).toBe(action === "accept" ? "Inserted海🌊Outside" : "Outside");
  expect((await product.inspectDocumentRevisions(output, {}, fresh())).items).toEqual([]);
  expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0); expect(Buffer.compare(Buffer.from(new Uint8Array(memory.readFileSync("/input") as Buffer)), Buffer.from(original))).toBe(0);
});
