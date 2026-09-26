import { Volume } from "memfs";
import { beforeAll, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { runElementOpen } from "./run-properties.js";
import { useNativeProcess } from "../tests/native-process.js";

const code = `import {Volume} from 'memfs';import * as api from 'docx';import {createInterface} from 'node:readline';console.log(JSON.stringify({ready:true}));for await(const data of createInterface({input:process.stdin})){const r=JSON.parse(data),input=new Uint8Array(Buffer.from(r.input,'base64')),m=Volume.fromJSON({'/output':''}),sink={async write(b){m.appendFileSync('/output',b);}},ctx=()=>({signal:new AbortController().signal,limits:r.limits,budget:new api.DocumentBudget(r.host,new AbortController().signal,async()=>{})});try{if(r.route==='model'){const d=await api.Document(input,ctx());d.tables[0].cell(0,0).text=r.value;await d.save(sink);}else await api.editDocumentTables(input,{operation:'tables.set',options:{table:1,cell:'A1',text:r.value,output:'-'}},{...ctx(),stdout:sink,encoding:{order:'input',compression:'store'}});console.log(JSON.stringify({ok:true,output:Buffer.from(m.readFileSync('/output')).toString('base64')}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack,outputBytes:m.statSync('/output').size}));}}`;
const execute = useNativeProcess(["--input-type=module", "-e", code]);

const host = { xmlDepth: 16384, work: 4 * 1024 ** 3, retainedBytes: 4 * 1024 ** 3 };
const limits = { ...textContext.limits, maxArchiveBytes: 2 * 1024 ** 2, maxEntryBytes: 1024 ** 2, maxTotalBytes: 2 * 1024 ** 2, maxRetainedBytes: 4 * 1024 ** 3 };
// Mock the explicit scheduling port, retaining actual parsing and all charges.
// Real timer scheduling is exercised separately through the built public paths.
const context = () => ({ ...textContext, limits, budget: new api.DocumentBudget(host, new AbortController().signal, async () => {}) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const levels of [680, 1360, 4096])
describe(`nested native fixture; ${strict}; ${kind}; levels=${levels}`, () => {
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  let parts: Map<string, Uint8Array>, input: Uint8Array, original: Uint8Array;
  const value = "Revised 日本 עברית é 🌊";
  beforeAll(async () => {
  parts = readPackage(await textFixture("", {}, strict));
  const sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const start = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr>';
  const end = '<w:p/></w:tc></w:tr></w:tbl>';
  const retained = '<w:bookmarkStart w:id="71" w:name="NestedAnchor"/><!--nested-native-retain--><?nested retain?><w:bookmarkEnd w:id="71"/>';
  const body = start.repeat(levels) + retained + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Nested 日本 עברית é 🌊</w:t></w:r></w:p>' + end.repeat(levels);
  const outside = '<w:p><w:r><w:t>Outside 日本 עברית é 🌊</w:t></w:r></w:p>';
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body>${body}${outside}</w:body></w:document>`));
  if (kind === "dotx") {
    const xml = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!), main = xml.root.children.find(n => n.attributes.some(a => a.name === "PartName" && a.value === "/word/document.xml"))!;
    const changed = { ...main, attributes: main.attributes.map(a => a.name === "ContentType" ? { ...a, value: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml" } : a) };
    parts.set("[Content_Types].xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[main, runElementOpen(changed) + `</${main.name}>`]]))));
  }
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, context());
  input = new Uint8Array(memory.readFileSync("/input") as Buffer); original = input.slice();
  });
  for (const route of ["model", "direct"] as const)
  it(`whole cell text honors admitted nested native blocks; ${strict}; ${kind}; levels=${levels}; ${route}`, async () => {
  memory.writeFileSync("/output", "");
  const outside = '<w:p><w:r><w:t>Outside 日本 עברית é 🌊</w:t></w:r></w:p>';
  const response = await execute({ input: Buffer.from(input).toString("base64"), value, route, host, limits }) as { ok: boolean; output: string; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true });
  memory.writeFileSync("/output", new Uint8Array(Buffer.from(response.output, "base64")));
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), xml = new TextDecoder().decode(after.get("word/document.xml"));
  expect(xml).toContain('w:id="71"'); expect(xml).toContain('w:name="NestedAnchor"'); expect(xml).toContain("<!--nested-native-retain-->"); expect(xml).toContain("<?nested retain?>"); expect(xml).toContain(outside);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, context()), cell = doc.tables[0]!.cell(0, 0);
  expect(cell.text).toBe(value); expect(cell.width!.inches).toBe(1); expect(cell.tables.length).toBe(0); expect(cell.paragraphs.length).toBe(1); expect(cell.paragraphs[0]!.runs.length).toBe(1); expect(cell.paragraphs[0]!.runs[0]!.bold).toBe(null); expect(doc.paragraphs[0]!.text).toBe("Outside 日本 עברית é 🌊");
  expect(Buffer.from(input).equals(Buffer.from(original))).toBe(true);
  expect((memory.readFileSync("/input") as Buffer).equals(Buffer.from(original))).toBe(true);
});
});
