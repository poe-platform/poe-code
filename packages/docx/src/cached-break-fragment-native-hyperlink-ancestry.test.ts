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
for (const preceding of [false, true]) for (const host of ["worker", "main"] as const)
it(`extracts complete nested hyperlink with cached-break native ancestors; strict=${strict}; depth=${depth}; preceding=${preceding}; host=${host}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" :
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" :
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const body = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Before</w:t></w:r>${'<w:customXml w:element="original">'.repeat(depth)}` +
    "<w:r><w:t>Left</w:t></w:r><w:hyperlink><w:r><w:t>LinkBefore</w:t><w:lastRenderedPageBreak/><w:t>LinkAfter</w:t></w:r></w:hyperlink><w:r><w:t>Right</w:t></w:r>" + "</w:customXml>".repeat(depth) +
    "<w:r><w:t>After</w:t></w:r><!--retain--><?cached keep?></w:p>";
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
    const cached = paragraph.rendered_page_breaks[0]!;
    const fragment = preceding ? cached.preceding_paragraph_fragment : cached.following_paragraph_fragment;
    expect(fragment?.text).toBe(preceding ? "Before" : "After");
    const fragmentXml = new TextDecoder().decode(fragment!.element.serialize());
    expect(fragmentXml.includes(">LinkBefore</w:t>")).toBe(preceding);
    expect(fragmentXml.includes(">LinkAfter</w:t>")).toBe(preceding);
    expect(fragmentXml.includes(">Left</w:t>")).toBe(preceding);
    expect(fragmentXml.includes(">Right</w:t>")).toBe(!preceding);
    expect(fragmentXml.includes("lastRenderedPageBreak")).toBe(false);
    expect(fragment?.paragraph_format.keep_with_next).toBe(true);
    expect(fragment?.store).not.toBe(paragraph.store);
    expect(paragraph.text).toBe("BeforeAfter");
    expect(paragraph.paragraph_format.keep_with_next).toBe(true);
    expect(paragraph.runs[0]!.italic).toBe(true);
    expect(Buffer.from(paragraph.element.serialize()).equals(Buffer.from(standaloneParagraph))).toBe(true);
    const snapshot = store.snapshot();
    expect(snapshot.members.map(member => member.name).sort()).toEqual(members.map(member => member.name).sort());
    for (const member of snapshot.members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
  } else {
    const script = `import {Volume} from 'memfs';import * as api from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};import {ModelStore} from ${JSON.stringify(new URL("./model-store.ts", import.meta.url).href)};import {archiveSettings} from ${JSON.stringify(new URL("./archive.ts", import.meta.url).href)};
let data='';for await(const chunk of process.stdin)data+=chunk;const request=JSON.parse(data),memory=Volume.fromJSON(Object.fromEntries(request.members.map(m=>['/'+m.name,Buffer.from(m.bytes,'base64')]))),members=request.members.map(m=>({...m,modified:new Date(m.modified),bytes:new Uint8Array(memory.readFileSync('/'+m.name))})),context={...archiveSettings({limits:request.limits,signal:new AbortController().signal,budget:new api.DocumentBudget({xmlDepth:16384,retainedBytes:2**30,work:2**30})}),author:'',initials:''},store=new ModelStore({comment:new Uint8Array(),members},context,'/word/document.xml'),node=store.xml(store.mainPart).root.children[0].children[0],p=new api.Paragraph(store,store.ref(store.mainPart,node));let result;try{const cached=p.rendered_page_breaks[0],fragment=request.preceding?cached.preceding_paragraph_fragment:cached.following_paragraph_fragment;result={ok:true,fragmentText:fragment?.text,wholeBefore:new TextDecoder().decode(fragment.element.serialize()).includes('>LinkBefore</w:t>'),wholeAfter:new TextDecoder().decode(fragment.element.serialize()).includes('>LinkAfter</w:t>'),nativeLeft:new TextDecoder().decode(fragment.element.serialize()).includes('>Left</w:t>'),nativeRight:new TextDecoder().decode(fragment.element.serialize()).includes('>Right</w:t>'),noMarker:!new TextDecoder().decode(fragment.element.serialize()).includes('lastRenderedPageBreak'),fragmentKeep:fragment?.paragraph_format.keep_with_next,detached:fragment?.store!==p.store,text:p.text,keep:p.paragraph_format.keep_with_next,italic:p.runs[0].italic,exactParagraph:Buffer.from(p.element.serialize()).equals(Buffer.from(request.body))};}catch(error){result={ok:false,error:String(error),code:error.code??null};}const saved=store.snapshot();result.exactMembers=saved.members.length===members.length&&saved.members.every(m=>Buffer.from(m.bytes).equals(memory.readFileSync('/'+m.name)));console.log(JSON.stringify(result));`;
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); });
      child.stderr.on("data", bytes => { stderr += String(bytes); });
      child.on("error", reject);
      child.on("close", code => { if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
      child.stdin.end(JSON.stringify({ members: members.map(member => ({ ...member,
        bytes: Buffer.from(member.bytes).toString("base64") })), limits: textContext.limits, body: standaloneParagraph, preceding }));
    });
    expect(JSON.parse(result)).toEqual({ ok: true, fragmentText: preceding ? "Before" : "After", wholeBefore: preceding, wholeAfter: preceding, nativeLeft: preceding, nativeRight: !preceding, noMarker: true, fragmentKeep: true, detached: true,
      text: "BeforeAfter", keep: true, italic: true, exactParagraph: true, exactMembers: true });
  }
  for (const member of members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
});
