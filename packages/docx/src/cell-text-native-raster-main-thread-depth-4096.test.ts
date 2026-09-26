import { Volume } from "memfs";
import { beforeAll, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { runElementOpen } from "./run-properties.js";
import { useNativeProcess } from "../tests/native-process.js";


const code = `import {Volume} from 'memfs';import * as api from 'docx';import {createInterface} from 'node:readline';console.log(JSON.stringify({ready:true}));for await(const data of createInterface({input:process.stdin})){const r=JSON.parse(data),input=new Uint8Array(Buffer.from(r.input,'base64')),m=Volume.fromJSON({'/output':''}),sink={async write(b){m.appendFileSync('/output',b);}},ctx=()=>({signal:new AbortController().signal,limits:r.limits,budget:new api.DocumentBudget(r.host)});try{if(r.route==='model'){const admitted=await api.Document(input,ctx());admitted.tables[0].cell(0,0).text=r.value;await admitted.save(sink);}else await api.editDocumentTables(input,{operation:'tables.set',options:{table:1,cell:'A1',text:r.value,output:'-'}},{...ctx(),encoding:{order:'input',compression:'store'},stdout:sink});console.log(JSON.stringify({ok:true,output:Buffer.from(m.readFileSync('/output')).toString('base64')}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack,outputBytes:m.statSync('/output').size}));}}`;
const execute = useNativeProcess(["--input-type=module", "-e", code]);

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const placement of ["selected", "preceding"] as const)
describe(`native raster cell; ${dialect}; ${kind}; ${placement}`, () => {
  let nativeFixture: { memory: Volume; input: Uint8Array; parts: Map<string, Uint8Array>; width: number; limits: typeof textContext.limits; host: { xmlDepth: number; retainedBytes: number; work: number } };
  const value = "Revised 日本 עברית é 🌊";
  beforeAll(async () => {
  const memory = Volume.fromJSON({ "/authored": "", "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const doc = await api.Document(await fixture(dialect, kind, variants[0]!), textContext), section = doc.sections[0]!;
  section.page_width = api.Inches(8); section.left_margin = api.Inches(1); section.right_margin = api.Inches(1);
  const cell = doc.add_table(1, 1).cell(0, 0), width = cell.width!.emu;
  await cell.paragraphs[0]!.add_run("Cell native").add_picture(rasterPng()); await doc.save(sink("/authored"));
  const parts = readPackage(new Uint8Array(memory.readFileSync("/authored") as Buffer)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), pending = [xml.root], blips: api.XmlElement[] = [];
  while (pending.length) { const node = pending.pop()!; if (node.localName === "blip") blips.push(node); for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!); }
  const blip = blips[placement === "selected" ? 2 : 0]!, depth = 4096;
  const effect = `<a:alphaMod xmlns:a="${blip.namespace}"><a:cont type="tree">` + '<a:cont type="tree">'.repeat(depth) + '<a:lum bright="10000"/>' + "</a:cont>".repeat(depth) + "</a:cont></a:alphaMod>";
  parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[blip, runElementOpen(blip) + effect + `</${blip.name}>`]]))));
  const host = { xmlDepth: 8192, retainedBytes: 4 * 1024 ** 3, work: 4 * 1024 ** 3 }, limits = { ...textContext.limits, maxArchiveBytes: 1024 ** 2, maxEntryBytes: 512 * 1024, maxTotalBytes: 1024 ** 2, maxRetainedBytes: 4 * 1024 ** 3 };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, { ...textContext, limits, budget: new api.DocumentBudget(host) });
  nativeFixture = { input: new Uint8Array(memory.readFileSync("/input") as Buffer), memory, parts, width, host, limits };
  });
  for (const route of ["model", "direct"] as const)
  it(`cell text honors admitted native raster depth4096 in normal main thread; ${dialect}; ${kind}; ${placement}; ${route}`, async () => {
  const { memory, input, parts, width, limits, host } = nativeFixture;
  const response = await execute({ input: Buffer.from(input).toString("base64"), route, value, limits, host }) as { ok: boolean; output: string; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true });
  const output = new Uint8Array(Buffer.from(response.output, "base64")), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const reopened = await api.Document(output, { ...textContext, limits, budget: new api.DocumentBudget(host) }), changed = reopened.tables[0]!.cell(0, 0);
  expect(changed.text).toBe(value); expect(changed.width!.emu).toBe(width); expect(changed.paragraphs.length).toBe(1); expect(changed.paragraphs[0]!.runs.length).toBe(1);
  expect(changed.paragraphs[0]!.alignment).toBe(null); expect(changed.paragraphs[0]!.runs[0]!.bold).toBe(null); expect(reopened.paragraphs[0]!.text).toBe("Selected 日本 עברית 🌊"); expect(reopened.paragraphs[1]!.text).toBe("Unselected é海");
  expect((await api.inspectDocument(output, { ...textContext, limits, budget: new api.DocumentBudget(host) })).counts.images).toBe(2); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  });
});
