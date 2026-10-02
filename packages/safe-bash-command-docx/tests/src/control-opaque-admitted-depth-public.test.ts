import { Volume } from "memfs";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { writeArchive } from "../../../safe-bash-docx-engine/src/index.js";
import { textContext, textFixture } from "../../../safe-bash-docx-engine/tests/fixtures/text.js";
import { readPackage } from "../../../safe-bash-docx-engine/tests/assertions.js";
import { prepareNativeModelScript } from "../../../safe-bash-docx-engine/tests/fixtures/native-model.js";

let native: Awaited<ReturnType<Awaited<ReturnType<typeof prepareNativeModelScript>>>> | undefined;
beforeAll(async () => {
  const startNative = await prepareNativeModelScript(`const input=new Uint8Array(Buffer.from(request.input,'base64')),saved=input.slice(),signal=new AbortController().signal,documentLimits={xmlDepth:8192},budget=()=>new api.DocumentBudget(documentLimits,signal),memory=Volume.fromJSON({'/output':''}),context={limits:request.limits,signal,budget:budget(),encoding:{order:'input',compression:'store'},stdout:{async write(bytes){memory.appendFileSync('/output',bytes);}}},ops={version:1,operations:[{operation:'controls.set',arguments:{all:true,text:'Shore'}}]};
const observed=await api.inspectDocumentControls(input,{}, {limits:request.limits,signal,budget:budget()});assert.deepEqual(observed.items.map(item=>item.value),['Coast','Coast']);let errorCode=null,errorStack=null;
try{if(request.route==='sdk')await api.editDocumentControls(input,{all:true,text:'Shore',output:'-'},context);else if(request.route==='sdk-batch')await api.executeDocumentBatch(input,ops,{output:'-'},context);else{const {Shell,MemoryFileSystem}=await import('@poe-platform/safe-bash');const {docxCommands}=await import('@poe-platform/safe-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/output',new TextEncoder().encode('Retained destination'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits})}));try{const command=request.route==='cli'?'docx controls set /input --all --text Shore --output /output --force --json':'docx batch /input --ops-json '+JSON.stringify(JSON.stringify(ops))+' --output /output --force --json';const result=await shell.exec(command);assert.deepEqual(await fs.readFile('/input'),saved);assert.equal(new TextDecoder().decode(await fs.readFile('/output')),'Retained destination');if(result.exitCode!==0){const envelope=JSON.parse(result.stdout);assert.equal(envelope.affected,0);errorCode=envelope.errors[0].code;}}finally{await shell.dispose();}}}catch(error){errorCode=error.code??null;errorStack=error.stack;}assert.deepEqual(input,saved);assert.equal(memory.statSync('/output').size,0);console.log(JSON.stringify({errorCode,errorStack,exactSourceDestinationAndZeroPublication:true,observedValues:observed.items.map(item=>item.value)}));`, `import assert from "node:assert/strict";
import { Volume } from "memfs";
import * as api from "safe-bash-command-docx/sdk";
import "@poe-platform/safe-bash";
import "@poe-platform/safe-bash/commands/docx";`);
  native = await startNative();
});
afterEach(async () => {
  if (native) expect(JSON.parse(await native.run({ cleanup: true }, new AbortController().signal))).toEqual({ cleaned: true });
});
afterAll(async () => { await native?.dispose(); });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const depth of [32, 4096])
it(`native opaque control fill rejects atomically at depth${depth}; strict=${strict}; kind=${kind}; route=${route}`, async ({ signal }) => {
  const parts = readPackage(await textFixture("<w:p/>", {}, strict, { kind }));
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const control = (id: number, body: string) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:text/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Coast</w:t>${body}</w:r></w:sdtContent></w:sdt>`;
  const opaque = "<f:opaque>".repeat(depth) + '<w:t>Never activated</w:t>' + "</f:opaque>".repeat(depth);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}" xmlns:f="urn:original:inert-control" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p>${control(31, "")}</w:p><w:p>${control(32, opaque)}</w:p></w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "" });
  const limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const result = await native!.run({ input: Buffer.from(input).toString("base64"), limits, route }, signal);
  const response = JSON.parse(result) as { errorCode: string | null; errorStack: string | null };
  expect(response, response.errorStack ?? undefined).toMatchObject({ errorCode: "unsupported-edit", exactSourceDestinationAndZeroPublication: true, observedValues: ["Coast", "Coast"] });
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
