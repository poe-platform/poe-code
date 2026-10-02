import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Volume } from "memfs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const productUrl = new URL("../dist/index.js", import.meta.url).href;
const program = `import {Volume} from 'memfs';import * as api from ${JSON.stringify(productUrl)};import {createInterface} from 'node:readline';process.stdout.write('ready\\n');for await(const raw of createInterface({input:process.stdin})){const q=JSON.parse(raw);if(q.cleanup){globalThis.gc();process.stdout.write(JSON.stringify({cleaned:true})+'\\n');continue}const memory=Volume.fromJSON({'/input':Buffer.from(q.base64,'base64'),'/output':'Retained destination'}),input=new Uint8Array(memory.readFileSync('/input')),before=input.slice(),signal=new AbortController().signal,documentLimits={xmlDepth:16384,retainedBytes:2147483648,work:2147483648},context={limits:q.limits,signal,budget:new api.DocumentBudget(documentLimits,signal)},ref=(resultHandle,index)=>({resultHandle,...(index===undefined?{}:{index})}),operations=[{operation:'model.document.Document.comments.get',receiver:ref('document'),arguments:{},resultHandle:'comments'},{operation:'model.comments.Comments.get.call',receiver:ref('comments'),arguments:{commentId:17},resultHandle:'comment'},{operation:'model.comments.Comment.paragraphs.get',receiver:ref('comment'),arguments:{},resultHandle:'paragraphs'},{operation:'model.text.paragraph.Paragraph.runs.get',receiver:ref('paragraphs',0),arguments:{},resultHandle:'runs'},{operation:'model.text.run.Run.iter_inner_content.call',receiver:ref('runs',0),arguments:{},resultHandle:'drawings'},{operation:'model.drawing.Drawing.'+q.action+'.get',receiver:ref('drawings',0),arguments:{}}],sink={async write(bytes){memory.appendFileSync('/saved',bytes)}},result={};try{if(q.route==='model'){const document=await api.Document(input,context),contents=[...document.comments.get(17).paragraphs[0].runs[0].iter_inner_content()];result.oneDrawing=contents.length===1&&contents[0] instanceof api.Drawing;const drawing=contents[0];if(q.action==='image'){try{drawing.image;result.code='unexpected-success'}catch(error){result.code=error.code??null;result.expectedType=error instanceof api.MissingKeyError}}else{result.value=drawing.has_picture;memory.writeFileSync('/saved','');await document.save(sink)}}else if(q.route==='sdk'){try{const batch=await api.applyStyleModelBatch(input,{version:1,operations},context);result.oneDrawing=batch.results[4].value.length===1&&batch.results[4].value[0].type==='Drawing';result.value=batch.results.at(-1).value;result.unchangedEffects=batch.affected===0&&batch.changes.length===0;if(q.depth===32){memory.writeFileSync('/saved','');await batch.save(sink)}}catch(error){result.code=error.code??null;result.expectedType=error instanceof api.MissingKeyError}}else{const {Shell,MemoryFileSystem}=await import('@poe-platform/safe-bash'),{docxCommands}=await import('@poe-platform/safe-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/output',new TextEncoder().encode('Retained destination'));await fs.writeFile('/operations',new TextEncoder().encode(JSON.stringify({version:1,operations})));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:q.limits,documentLimits})}));try{const response=await shell.exec('docx batch /input --ops-file /operations --output /output --force --json'),data=JSON.parse(response.stdout);if(q.action==='image'){result.code=data.errors?.[0]?.code??'unexpected-success';result.zeroEffects=data.affected===0&&data.data===null;result.destinationRetained=new TextDecoder().decode(await fs.readFile('/output'))==='Retained destination'}else{result.exitCode=response.exitCode;result.value=data.data?.results?.at(-1)?.data;const items=data.data?.results?.[4]?.data;result.oneDrawing=items?.length===1&&items[0].type==='Drawing';memory.writeFileSync('/saved',await fs.readFile('/output'))}result.sourceRetained=Buffer.from(await fs.readFile('/input')).equals(Buffer.from(before))}finally{await shell.dispose()}}result.exactInput=Buffer.from(input).equals(Buffer.from(before))&&Buffer.from(memory.readFileSync('/input')).equals(Buffer.from(before));if(q.action==='has_picture'&&memory.existsSync('/saved')){const saved=await api.readArchive(new Uint8Array(memory.readFileSync('/saved')),{limits:q.limits,signal}),original=await api.readArchive(before,{limits:q.limits,signal});result.exactMembers=saved.members.length===original.members.length&&saved.members.every(m=>Buffer.from(m.bytes).equals(Buffer.from(original.members.find(o=>o.name===m.name)?.bytes??[])))}result.ok=true}catch(error){result.ok=false;result.code=error.code??null;result.error=String(error)}process.stdout.write(JSON.stringify(result)+'\\n');}`;
let child: ChildProcessWithoutNullStreams;
const pending: { resolve(value: string): void; reject(error: Error): void }[] = [];

beforeAll(async () => {
  child = spawn(process.execPath, ["--expose-gc", "--input-type=module", "-e", program], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", bytes => {
    stdout += String(bytes);
    let newline: number;
    while ((newline = stdout.indexOf("\n")) >= 0) {
      pending.shift()?.resolve(stdout.slice(0, newline));
      stdout = stdout.slice(newline + 1);
    }
  });
  child.stderr.on("data", bytes => { stderr += String(bytes); });
  const fail = (error: Error) => { for (const request of pending.splice(0)) request.reject(error); };
  child.on("error", fail);
  child.on("close", code => { if (code !== 0 || pending.length) fail(new Error(stderr || `Native test process exited: ${code}`)); });
  await new Promise<string>((resolve, reject) => pending.push({ resolve, reject }));
});

afterEach(async () => {
  expect(JSON.parse(await nativeRequest({ cleanup: true }))).toEqual({ cleaned: true });
});

afterAll(async () => {
  if (child.exitCode !== null) return;
  const closed = new Promise<void>((resolve, reject) => child.once("close", code => code === 0 ? resolve() : reject(new Error(`Native test process exited: ${code}`))));
  child.stdin.end();
  await closed;
});

function nativeRequest(request: object): Promise<string> {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
    child.stdin.write(JSON.stringify(request) + "\n");
  });
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const depth of [32, 8192]) describe(`comment drawing fixture; strict=${strict}; kind=${kind}; depth=${depth}`, () => {
  let limits: typeof textContext.limits;
  let memory: Volume;
  let input: Uint8Array;
  beforeAll(async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const drawing = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const initial = await textFixture('<w:p><w:r><w:t>Retained 海🌊</w:t></w:r></w:p>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${word}"/>` } }, strict, { kind });
  const archive = await api.readArchive(initial, textContext), commentXml = `<w:comments xmlns:w="${word}" xmlns:a="${drawing}"><w:comment w:id="17" w:author="Archive" w:date="2026-04-05T06:07:08Z"><w:p><w:r><w:drawing><a:graphic><a:graphicData uri="urn:original:inert-drawing"><a:extLst>${'<a:ext uri="urn:original:inert-extension">'.repeat(depth)}<a:leaf/>${"</a:ext>".repeat(depth)}</a:extLst></a:graphicData></a:graphic></w:drawing></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>`;
  limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 1048576, maxTotalBytes: 1048576, maxRetainedBytes: 2147483648 };
  memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/comments.xml" ? { ...member, bytes: new TextEncoder().encode(commentXml) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  });
for (const route of ["model", "sdk", "cli"] as const) for (const action of ["has_picture", "image"] as const)
it(`comment Drawing inspects admitted inert native extensions without main-host recursion; strict=${strict}; kind=${kind}; depth=${depth}; route=${route}; action=${action}`, async () => {
  // Execute the actual public routes on the native main thread, whose stack
  // cannot borrow the test worker's capacity. All file operations stay in memfs.
  const output = await nativeRequest({ limits, route, action, depth, base64: Buffer.from(input).toString("base64") });
  const result = JSON.parse(output); expect(result, output).toMatchObject({ ok: true, exactInput: true });
  if (action === "has_picture") {
    expect(result).toMatchObject({ oneDrawing: true, value: false });
    // Deep SDK rows exercise the query; shallow SDK and deep CLI rows cover publication.
    if (route === "sdk") expect(result.unchangedEffects).toBe(true);
    if (route !== "sdk" || depth === 32) expect(result.exactMembers).toBe(true);
    if (route === "cli") expect(result.exitCode).toBe(0);
  }
  else { expect(result).toMatchObject({ code: "missing-selection" }); if (route === "model" || route === "sdk") expect(result.expectedType).toBe(true); else expect(result).toMatchObject({ zeroEffects: true, destinationRetained: true }); }
  if (route === "cli") expect(result.sourceRetained).toBe(true);
  expect((memory.readFileSync("/input") as Buffer).equals(Buffer.from(input))).toBe(true);
});

});
