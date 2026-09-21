import { Volume } from "memfs";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { runElementOpen } from "./run-properties.js";

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const selectedIndex of [1]) for (const depth of [2048]) for (const target of ["run", "paragraph"] as const) for (const route of ["model", "direct"] as const)
it(`main-thread destructive raster text honors admitted effect depth; ${dialect}; ${kind}; depth=${depth}; ${target}; ${route}${selectedIndex ? "; second-picture" : ""}`, async () => {
  const parts = readPackage(await fixture(dialect, kind, variants[0]!)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!);
  const pending = [xml.root], blips: api.XmlElement[] = [];
  while (pending.length) { const node = pending.pop()!; if (node.localName === "blip") blips.push(node); pending.push(...[...node.children].reverse()); }
  const blip = blips[selectedIndex];
  expect(blip).toBeDefined();
  const effect = `<a:alphaMod xmlns:a="${blip!.namespace}"><a:cont type="tree">` + '<a:cont type="tree">'.repeat(depth) + '<a:lum bright="10000"/>' + "</a:cont>".repeat(depth) + "</a:cont></a:alphaMod>";
  parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[blip!, runElementOpen(blip!) + effect + `</${blip!.name}>`]]))));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const context = { ...textContext, limits: { ...textContext.limits, maxArchiveBytes: 1024 * 1024, maxEntryBytes: 512 * 1024, maxTotalBytes: 1024 * 1024, maxRetainedBytes: 4 * 1024 * 1024 * 1024 }, budget: new api.DocumentBudget({ xmlDepth: 8192, retainedBytes: 4 * 1024 * 1024 * 1024, work: 4 * 1024 * 1024 * 1024 }) };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "Revised 日本 עברית 🌊";
  const code = `import {Volume} from 'memfs';import * as api from 'docx';let data='';for await(const bytes of process.stdin)data+=bytes;const request=JSON.parse(data),input=new Uint8Array(Buffer.from(request.input,'base64')),memory=Volume.fromJSON({'/output':''}),sink={async write(bytes){memory.appendFileSync('/output',bytes);}},context={signal:new AbortController().signal,limits:request.limits,budget:new api.DocumentBudget({xmlDepth:8192,retainedBytes:4*1024*1024*1024,work:4*1024*1024*1024})};try{if(request.route==='model'){const doc=await api.Document(input,context),p=doc.paragraphs[request.selectedIndex];(request.target==='run'?p.runs[0]:p).text=request.value;await doc.save(sink);}else{const ctx={...context,encoding:{order:'input',compression:'store'},stdout:sink};if(request.target==='run')await api.formatDocumentRuns(input,{paragraph:request.selectedIndex+1,run:1,text:request.value,output:'-'},ctx);else await api.editDocumentParagraphs(input,{operation:'paragraphs.set',options:{paragraph:request.selectedIndex+1,text:request.value,output:'-'}},ctx);}const output=new Uint8Array(memory.readFileSync('/output')),doc=await api.Document(output,context);console.log(JSON.stringify({ok:true,output:Buffer.from(output).toString('base64'),text:doc.paragraphs[request.selectedIndex].text}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??null,stack:error.stack,outputBytes:memory.statSync('/output').size}));}`;
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); }); child.on("error", reject); child.on("close", status => { if (status !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits: context.limits, route, target, selectedIndex, value }));
  });
  const response = JSON.parse(result) as { ok: boolean; output: string; text: string; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true, text: value });
  const output = new Uint8Array(Buffer.from(response.output, "base64")), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect((await api.inspectDocument(output, context)).counts.images).toBe(1); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);

});
