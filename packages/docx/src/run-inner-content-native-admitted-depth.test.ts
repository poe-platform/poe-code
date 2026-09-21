import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { beforeAll, expect, it } from "vitest";
import * as api from "./index.js";
import { archiveSettings, type DocumentArchive } from "./archive.js";
import { ModelStore } from "./model-store.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

let original: DocumentArchive;
beforeAll(async () => { original = await api.readArchive(await textFixture("<w:p/>"), textContext); });

for (const strict of [false, true]) for (const depth of [32, 4096, 8192])
for (const present of [false, true]) for (const host of ["worker", "main"] as const)
it(`iterates shallow selected run after admitted native depth without host recursion; strict=${strict}; depth=${depth}; present=${present}; host=${host}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" :
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" :
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const body = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Before</w:t></w:r>${'<w:customXml w:element="original">'.repeat(depth)}` +
    "<w:r/>" + "</w:customXml>".repeat(depth) +
    `<w:r><w:t>After</w:t>${present ? "<w:lastRenderedPageBreak/>" : ""}<w:t>Tail</w:t></w:r><!--retain--><?cached keep?></w:p>`;
  const memory = Volume.fromJSON(Object.fromEntries(original.members.map(member => ["/" + member.name,
    Buffer.from(new TextDecoder().decode(member.bytes).split("http://schemas.openxmlformats.org/officeDocument/2006/relationships").join(r))])));
  memory.writeFileSync("/word/document.xml", `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`);
  const members = original.members.map(member => ({ ...member, bytes: new Uint8Array(memory.readFileSync("/" + member.name) as Buffer) }));
  const context = { ...archiveSettings({ ...textContext, budget: new api.DocumentBudget({ xmlDepth: 16384,
    retainedBytes: 2 ** 30, work: 2 ** 30 }) }), author: "", initials: "" };
  const standaloneParagraph = body.replace("<w:p>", `<w:p xmlns:w="${w}">`);
  if (host === "worker") {
    // Exercise the real admitted model, XML and compatibility graph. Archive
    // acquisition/publication remain independently executed public obligations.
    const store = new ModelStore({ ...original, members }, context, "/word/document.xml");
    const node = store.xml(store.mainPart).root.children[0]!.children[0]!;
    const paragraph = new api.Paragraph(store, store.ref(store.mainPart, node));
    const contents = [...paragraph.runs[1]!.iter_inner_content()];
    expect(contents.filter(item => typeof item === "string")).toEqual(present ? ["After", "Tail"] : ["AfterTail"]);
    expect(contents.filter(item => item instanceof api.RenderedPageBreak)).toHaveLength(present ? 1 : 0);
    for (const item of contents) if (item instanceof api.RenderedPageBreak) {
      expect(item.preceding_paragraph_fragment?.text).toBe("BeforeAfter");
      expect(item.following_paragraph_fragment?.text).toBe("Tail");
    }
    expect(paragraph.contains_page_break).toBe(present);
    expect(paragraph.text).toBe("BeforeAfterTail");
    expect(paragraph.paragraph_format.keep_with_next).toBe(true);
    expect(paragraph.runs[0]!.italic).toBe(true);
    expect(Buffer.from(paragraph.element.serialize()).equals(Buffer.from(standaloneParagraph))).toBe(true);
    const snapshot = store.snapshot();
    expect(snapshot.members.map(member => member.name).sort()).toEqual(members.map(member => member.name).sort());
    for (const member of snapshot.members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
  } else {
    const script = `import {Volume} from 'memfs';import * as api from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};import {ModelStore} from ${JSON.stringify(new URL("./model-store.ts", import.meta.url).href)};import {archiveSettings} from ${JSON.stringify(new URL("./archive.ts", import.meta.url).href)};
let data='';for await(const chunk of process.stdin)data+=chunk;const request=JSON.parse(data),memory=Volume.fromJSON(Object.fromEntries(request.members.map(m=>['/'+m.name,Buffer.from(m.bytes,'base64')]))),members=request.members.map(m=>({...m,modified:new Date(m.modified),bytes:new Uint8Array(memory.readFileSync('/'+m.name))})),context={...archiveSettings({limits:request.limits,signal:new AbortController().signal,budget:new api.DocumentBudget({xmlDepth:16384,retainedBytes:2**30,work:2**30})}),author:'',initials:''},store=new ModelStore({comment:new Uint8Array(),members},context,'/word/document.xml'),node=store.xml(store.mainPart).root.children[0].children[0],p=new api.Paragraph(store,store.ref(store.mainPart,node));let result;try{const contents=[...p.runs[1].iter_inner_content()];result={ok:true,count:contents.filter(item=>item instanceof api.RenderedPageBreak).length,strings:contents.filter(item=>typeof item==='string'),fragments:contents.filter(item=>item instanceof api.RenderedPageBreak).map(item=>[item.preceding_paragraph_fragment?.text,item.following_paragraph_fragment?.text]),present:p.contains_page_break,text:p.text,keep:p.paragraph_format.keep_with_next,italic:p.runs[0].italic,exactParagraph:Buffer.from(p.element.serialize()).equals(Buffer.from(request.body))};}catch(error){result={ok:false,error:String(error),code:error.code??null};}const saved=store.snapshot();result.exactMembers=saved.members.length===members.length&&saved.members.every(m=>Buffer.from(m.bytes).equals(memory.readFileSync('/'+m.name)));console.log(JSON.stringify(result));`;
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); });
      child.stderr.on("data", bytes => { stderr += String(bytes); });
      child.on("error", reject);
      child.on("close", code => { if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
      child.stdin.end(JSON.stringify({ members: members.map(member => ({ ...member,
        bytes: Buffer.from(member.bytes).toString("base64") })), limits: textContext.limits, body: standaloneParagraph }));
    });
    expect(JSON.parse(result)).toEqual({ ok: true, count: present ? 1 : 0, strings: present ? ["After", "Tail"] : ["AfterTail"], fragments: present ? [["BeforeAfter", "Tail"]] : [], present,
      text: "BeforeAfterTail", keep: true, italic: true, exactParagraph: true, exactMembers: true });
  }
  for (const member of members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
});
