import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { beforeAll, expect, it } from "vitest";
import * as api from "./index.js";
import { archiveSettings, type DocumentArchive } from "./archive.js";
import { ModelStore } from "./model-store.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

let original: DocumentArchive;
beforeAll(async () => { original = await api.readArchive(await textFixture("<w:p/>"), textContext); });

for (const strict of [false, true]) for (const depth of [1, 32, 4096, 8192, 16377])
for (const host of ["worker", "main"] as const)
it(`reads admitted native nested hyperlink paragraph text without host recursion; strict=${strict}; depth=${depth}; host=${host}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" :
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" :
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const value = "e\u0323\u0301 日本 \u2067אב\u2069 العربية 𠀀";
  const body = '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Before</w:t></w:r>' +
    "<w:hyperlink>".repeat(depth) + '<w:r><w:rPr><w:rtl/><w:lang w:val="ja-JP" w:bidi="he-IL"/></w:rPr><w:t>' +
    value + "</w:t></w:r>" + "</w:hyperlink>".repeat(depth) +
    '<w:r><w:t>After</w:t></w:r><!--retain--><?native keep?></w:p>';
  const memory = Volume.fromJSON(Object.fromEntries(original.members.map(member => ["/" + member.name,
    Buffer.from(new TextDecoder().decode(member.bytes).split("http://schemas.openxmlformats.org/officeDocument/2006/relationships").join(r))])));
  memory.writeFileSync("/word/document.xml", `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`);
  const members = original.members.map(member => ({ ...member, bytes: new Uint8Array(memory.readFileSync("/" + member.name) as Buffer) }));
  const limits = { ...textContext.limits, maxEntryBytes: 2 ** 21, maxArchiveBytes: 2 ** 22,
    maxTotalBytes: 2 ** 22, maxRetainedBytes: 2 ** 30 };
  const context = { ...archiveSettings({ ...textContext, limits, budget: new api.DocumentBudget({
    xmlDepth: 16384, retainedBytes: 2 ** 30, work: 2 ** 30 }) }), author: "", initials: "" };
  if (host === "worker") {
    const store = new ModelStore({ ...original, members }, context, "/word/document.xml");
    const node = store.xml(store.mainPart).root.children[0]!.children[0]!;
    const paragraph = new api.Paragraph(store, store.ref(store.mainPart, node));
    expect(paragraph.text).toBe("Before" + value + "After");
    expect(paragraph.paragraph_format.keep_with_next).toBe(true);
    const snapshot = store.snapshot();
    expect(snapshot.members.map(member => member.name).sort()).toEqual(members.map(member => member.name).sort());
    for (const member of snapshot.members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
  } else {
    const script = `import {Volume} from 'memfs';import * as api from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};import {ModelStore} from ${JSON.stringify(new URL("./model-store.ts", import.meta.url).href)};import {archiveSettings} from ${JSON.stringify(new URL("./archive.ts", import.meta.url).href)};
let data='';for await(const chunk of process.stdin)data+=chunk;const request=JSON.parse(data),memory=Volume.fromJSON(Object.fromEntries(request.members.map(m=>['/'+m.name,Buffer.from(m.bytes,'base64')]))),members=request.members.map(m=>({...m,modified:new Date(m.modified),bytes:new Uint8Array(memory.readFileSync('/'+m.name))})),context={...archiveSettings({limits:request.limits,signal:new AbortController().signal,budget:new api.DocumentBudget({xmlDepth:16384,retainedBytes:2**30,work:2**30})}),author:'',initials:''},store=new ModelStore({comment:new Uint8Array(),members},context,'/word/document.xml'),node=store.xml(store.mainPart).root.children[0].children[0],p=new api.Paragraph(store,store.ref(store.mainPart,node));let result;try{result={ok:true,text:p.text,keep:p.paragraph_format.keep_with_next};}catch(error){result={ok:false,error:String(error),code:error.code??null};}const saved=store.snapshot();result.exactMembers=saved.members.length===members.length&&saved.members.every(m=>Buffer.from(m.bytes).equals(memory.readFileSync('/'+m.name)));console.log(JSON.stringify(result));`;
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, TSX_DISABLE_CACHE: "1" }
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); });
      child.stderr.on("data", bytes => { stderr += String(bytes); });
      child.on("error", reject);
      child.on("close", code => { if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
      child.stdin.end(JSON.stringify({ members: members.map(member => ({ ...member,
        bytes: Buffer.from(member.bytes).toString("base64") })), limits }));
    });
    expect(JSON.parse(result)).toEqual({ ok: true, text: "Before" + value + "After", keep: true, exactMembers: true });
  }
  for (const member of members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
});
