import { expect, it } from "vitest";
import { Volume } from "memfs";
import { getDocumentXml, replaceDocumentXmlPart, readArchive, writeArchive, DocumentBudget, parseDocumentXml } from "./index.js";
import { textContext as context, textFixture, paragraph, w, r } from "../tests/fixtures/text.js";

const encode = (text: string) => new TextEncoder().encode(text);
const document = (body: string) => encode(`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:e="urn:coastal:extension"><w:body>${body}</w:body></w:document>`);
async function fixture(xml = document(paragraph("Original coast"))) {
  const source = await readArchive(await textFixture(paragraph("Original coast")), context);
  const files = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ ...source, members: source.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: xml } : member) },
    { async write(bytes) { files.appendFileSync("/archive", bytes); } }, { order: "name", compression: "store" }, context);
  return new Uint8Array(files.readFileSync("/archive") as Buffer);
}
const publication = { ...context, encoding: { order: "name", compression: "store" } as const };

it("reads an explicit XML part as exact bytes or lossless base64 metadata", async () => {
  const xml = document(`<w:p><w:r><w:t xml:space="preserve">  Coast &#13; &amp; dunes  </w:t></w:r></w:p><!--kept--><?survey coastal?>`);
  const input = await fixture(xml);
  expect(await getDocumentXml(input, context, { part: "/word/document.xml", raw: true })).toEqual(xml);
  expect(await getDocumentXml(input, context, { part: "/word/document.xml" })).toMatchObject({ part: "/word/document.xml", encoding: "base64", content: Buffer.from(xml).toString("base64"), pretty: false, bytes: xml.length, sha256: expect.any(String) });
  for (const part of ["document.xml", "/word/*.xml", "/word/../word/document.xml"]) {
    await expect(getDocumentXml(input, context, { part })).rejects.toBeDefined();
  }
  await expect(getDocumentXml(input, context, { part: "/absent.xml" })).rejects.toMatchObject({ code: "missing-selection" });
});

it("preserves UTF-16 BOM bytes and displays UTF-8 without losing mixed-content whitespace", async () => {
  const text = `<?xml version="1.0" encoding="UTF-16"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t xml:space="preserve">  Coast <w:tab/> dunes  </w:t></w:r></w:p></w:body></w:document>`;
  const xml = new Uint8Array(Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, "utf16le")]));
  const input = await fixture(xml);
  expect(await getDocumentXml(input, context, { part: "/word/document.xml", raw: true })).toEqual(xml);
  const pretty = await getDocumentXml(input, context, { part: "/word/document.xml", pretty: true });
  expect(pretty).toMatchObject({ encoding: "utf-8", pretty: true, bytes: xml.length });
  if (pretty instanceof Uint8Array) throw new Error("Expected display data");
  expect(pretty.content).toContain("\n");
  expect(pretty.content).toContain('  Coast <w:tab/> dunes  ');
  expect(parseDocumentXml(encode(pretty.content)).encoding).toBe("UTF-8");
});

it("replaces one XML part and preserves every unrelated uncompressed byte", async () => {
  const input = await fixture();
  const replacement = document(paragraph("Revised coast"));
  const files = Volume.fromJSON({ "/output": "" });
  const result = await replaceDocumentXmlPart(input, replacement, { part: "/word/document.xml", output: "-" }, {
    ...publication, stdout: { async write(bytes) { files.appendFileSync("/output", bytes); } }
  });
  const bytes = new Uint8Array(files.readFileSync("/output") as Buffer);
  expect(result).toMatchObject({ changed: true, dryRun: false, changes: [{ kind: "replace", before: { kind: "part" }, after: { kind: "part" } }], output: { path: "-", bytes: bytes.length, sha256: expect.any(String) } });
  const before = await readArchive(input, context);
  const after = await readArchive(bytes, context);
  for (const member of before.members) expect(after.members.find(m => m.name === member.name)!.bytes).toEqual(member.name === "word/document.xml" ? replacement : member.bytes);
});

it.each([
  encode('<w:p/>'), encode('<a/><b/>'), encode('<a>unterminated'),
  encode('<!DOCTYPE a [<!ENTITY x "oops">]><a>&x;</a>'), Uint8Array.of(255),
  encode('<?xml version="1.0" encoding="latin1"?><a/>'),
  document(`<w:p><w:hyperlink r:id="missing"><w:r><w:t>Coast</w:t></w:r></w:hyperlink></w:p>`),
  encode(`<w:document xmlns:w="urn:wrong"><w:body/></w:document>`)
])("rejects invalid replacement before any publication %#", async replacement => {
  const files = Volume.fromJSON({ "/output": "untouched" });
  await expect(replaceDocumentXmlPart(await fixture(), replacement, { part: "/word/document.xml", output: "-" }, {
    ...publication, stdout: { async write(bytes) { files.writeFileSync("/output", bytes); } }
  })).rejects.toBeDefined();
  expect(files.toJSON()).toEqual({ "/output": "untouched" });
});

it("preserves unknown namespace content and rejects changed or removed opaque content", async () => {
  const opaque = '<e:record e:code="7">  preserved <e:leaf/> tail </e:record>';
  const input = await fixture(document(paragraph("Original coast") + opaque));
  expect(await replaceDocumentXmlPart(input, document(paragraph("Revised coast") + opaque), { part: "/word/document.xml", dryRun: true }, publication)).toMatchObject({ changed: true, dryRun: true, output: null });
  for (const body of [paragraph("Revised coast"), paragraph("Revised coast") + '<e:record e:code="8">changed</e:record>']) {
    await expect(replaceDocumentXmlPart(input, document(body), { part: "/word/document.xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "unsupported-edit" });
  }
});

it("refuses protection removal and dangling package relationships", async () => {
  const protectedInput = await fixture(document('<w:p><w:sdt><w:sdtPr><w:text/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>Locked coast</w:t></w:r></w:sdtContent></w:sdt></w:p>'));
  await expect(replaceDocumentXmlPart(protectedInput, document(paragraph("Revised coast")), { part: "/word/document.xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "unsupported-edit" });
  const rels = encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="missing.xml"/></Relationships>`);
  await expect(replaceDocumentXmlPart(await fixture(), rels, { part: "/_rels/.rels", dryRun: true }, publication)).rejects.toBeDefined();
});

it("bounds raw and pretty output and reports byte-identical no-op replacement", async () => {
  const input = await fixture();
  for (const options of [{ raw: true }, { pretty: true }]) {
    await expect(getDocumentXml(input, { ...context, budget: new DocumentBudget({ serializedOutput: 16 }) }, { part: "/word/document.xml", ...options })).rejects.toMatchObject({ code: "limit-exceeded" });
  }
  expect(await replaceDocumentXmlPart(input, document(paragraph("Original coast")), { part: "/word/document.xml", dryRun: true }, publication)).toMatchObject({ changed: false, changes: [], output: null });
});

it("rejects document-kind conversion through content-type replacement", async () => {
  const input = await fixture();
  const archive = await readArchive(input, context);
  const types = new TextDecoder().decode(archive.members.find(member => member.name === "[Content_Types].xml")!.bytes);
  const replacement = encode(types.split("document.main+xml").join("template.main+xml"));
  await expect(replaceDocumentXmlPart(input, replacement, { part: "/[Content_Types].xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("accounts for inserted XML nodes before publishing a replacement", async () => {
  await expect(replaceDocumentXmlPart(await fixture(), document(paragraph("Revised coast")), { part: "/word/document.xml", dryRun: true },
    { ...publication, budget: new DocumentBudget({ insertedNodes: 0 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("snapshots XML display options before asynchronous admission", async () => {
  const input = await fixture();
  const options = { part: "/word/document.xml", raw: true };
  const pending = getDocumentXml(input, context, options);
  options.raw = false;
  expect(await pending).toBeInstanceOf(Uint8Array);
});

it("applies explicit allow-empty to a missing part without masking invalid XML", async () => {
  const input = await fixture();
  await expect(replaceDocumentXmlPart(input, document(paragraph("Revised coast")), { part: "/absent.xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "missing-selection" });
  expect(await replaceDocumentXmlPart(input, document(paragraph("Revised coast")), { part: "/absent.xml", allowEmpty: true, dryRun: true }, publication)).toMatchObject({ changed: false, changes: [], output: null, dryRun: true });
  await expect(replaceDocumentXmlPart(input, encode("<broken>"), { part: "/absent.xml", allowEmpty: true, dryRun: true }, publication)).rejects.toMatchObject({ code: "invalid-xml" });
});

async function customDataFixture(bound: boolean) {
  const namespace = bound ? w : "urn:original:values";
  const body = bound ? `<w:p><w:sdt><w:sdtPr><w:tag w:val="name"/><w:text/><w:dataBinding w:storeItemID="1111" w:xpath="/v:root/v:value" w:prefixMappings="xmlns:v='${namespace}'"/></w:sdtPr><w:sdtContent>${paragraph("Old").slice(5, -6)}</w:sdtContent></w:sdt></w:p>` : paragraph("Coast");
  const source = await readArchive(await textFixture(body), context);
  const item = encode(`<v:root xmlns:v="${namespace}"><v:value>Old</v:value></v:root>`), props = encode('<d:datastoreItem xmlns:d="http://schemas.openxmlformats.org/officeDocument/2006/customXml" d:itemID="1111"><d:schemaRefs><d:schemaRef d:uri="urn:original:schema"/></d:schemaRefs></d:datastoreItem>');
  const members = source.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/data/properties.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>')) } : member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Relationships>', `<Relationship Id="data" Type="${r}/customXml" Target="../data/item.xml"/></Relationships>`)) } : member);
  members.push({ name: "data/item.xml", bytes: item, directory: false, modified: new Date("2025-01-01") }, { name: "data/properties.xml", bytes: props, directory: false, modified: new Date("2025-01-01") }, { name: "data/_rels/item.xml.rels", bytes: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="props" Type="${r}/customXmlProps" Target="properties.xml"/></Relationships>`), directory: false, modified: new Date("2025-01-01") });
  const fs = Volume.fromJSON({ "/archive": "" }); await writeArchive({ ...source, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, context);
  return { bytes: new Uint8Array(fs.readFileSync("/archive") as Buffer), item, props };
}
it("permits explicit unbound inert custom data replacement while preserving unrelated parts", async () => {
  const source = await customDataFixture(false), fs = Volume.fromJSON({ "/output": "" });
  const result = await replaceDocumentXmlPart(source.bytes, encode(new TextDecoder().decode(source.item).replace('>Old<', '>New<')), { part: "/data/item.xml", output: "-" }, { ...publication, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } });
  expect(result.changed).toBe(true);
  const before = await readArchive(source.bytes, context), after = await readArchive(new Uint8Array(fs.readFileSync("/output") as Buffer), context);
  for (const member of before.members.filter(member => member.name !== "data/item.xml")) expect(after.members.find(candidate => candidate.name === member.name)!.bytes).toEqual(member.bytes);
});
it.each(["item", "properties", "declaration"])("rejects changed raw bound %s data before publication", async target => {
  const source = await customDataFixture(true), writes: Uint8Array[] = []; const main = await getDocumentXml(source.bytes, context, { part: "/word/document.xml", raw: true }) as Uint8Array;
  const part = target === "declaration" ? "/word/document.xml" : `/data/${target === "item" ? "item" : "properties"}.xml`, original = target === "item" ? source.item : target === "properties" ? source.props : main;
  const replacement = encode(new TextDecoder().decode(original).replace(target === "item" ? '>Old<' : target === "properties" ? 'itemID="1111"' : '/v:root/v:value', target === "item" ? '>New<' : target === "properties" ? 'itemID="2222"' : '/v:root/v:other'));
  await expect(replaceDocumentXmlPart(source.bytes, replacement, { part, output: "-" }, { ...publication, stdout: { async write(bytes) { writes.push(bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" }); expect(writes).toEqual([]);
});
it("recognizes an explicitly rooted custom data relation for unbound raw replacement", async () => {
  const source = await customDataFixture(false), archive = await readArchive(source.bytes, context), fs = Volume.fromJSON({ "/input": "", "/output": "" });
  const members = archive.members.map(member => member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') } : member.name === "_rels/.rels" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Relationships>', `<Relationship Id="data" Type="${r}/customXml" Target="data/item.xml"/></Relationships>`)) } : member);
  await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  await expect(replaceDocumentXmlPart(new Uint8Array(fs.readFileSync("/input") as Buffer), encode(new TextDecoder().decode(source.item).replace('>Old<', '>New<')), { part: "/data/item.xml", output: "-" }, { ...publication, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } })).resolves.toMatchObject({ changed: true });
});
it.each(["/data/item.xml", "/data/properties.xml", "/word/document.xml"])("preserves byte-identical raw bound-part no-op %s and all relationships", async part => {
  const source = await customDataFixture(true), original = await getDocumentXml(source.bytes, context, { part, raw: true }) as Uint8Array, fs = Volume.fromJSON({ "/output": "" });
  await expect(replaceDocumentXmlPart(source.bytes, original, { part, output: "-" }, { ...publication, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } })).resolves.toMatchObject({ changed: false, changes: [] });
  const before = await readArchive(source.bytes, context), after = await readArchive(new Uint8Array(fs.readFileSync("/output") as Buffer), context);
  for (const member of before.members) expect(after.members.find(candidate => candidate.name === member.name)!.bytes).toEqual(member.bytes);
});

it('diagram raw replacement rejects with a source-bound part location before publication',async()=>{
 const {diagramFixture,diagramContext,diagramNamespace}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();let writes=0;
 const replacement=new TextEncoder().encode('<d:dataModel xmlns:d="'+diagramNamespace+'" changed="yes"/>');
 await expect(replaceDocumentXmlPart(input,replacement,{part:'/word/graphs/data.xml',output:'-'},{...diagramContext,encoding:{order:'input',compression:'store'},stdout:{async write(){writes++;}}})).rejects.toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part:'/word/graphs/data.xml',path:[],generation:0}}});expect(writes).toBe(0);
});
it('raw diagram envelope mutation rejects at its original inline graphics path',async()=>{
 const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const bytes=await getDocumentXml(input,diagramContext,{part:'/word/document.xml',raw:true}) as Uint8Array;
 const replacement=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('cx="200"','cx="400"'));
 await expect(replaceDocumentXmlPart(input,replacement,{part:'/word/document.xml',dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part:'/word/document.xml'}}});
});
it('unrelated raw text leaf retains opaque diagram envelope unchanged',async()=>{
 const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const bytes=await getDocumentXml(input,diagramContext,{part:'/word/document.xml',raw:true}) as Uint8Array;
 const replacement=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('>coast<','>long shore<'));
 expect((await replaceDocumentXmlPart(input,replacement,{part:'/word/document.xml',dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).changed).toBe(true);
});
it('raw relocation of preserved diagram payload rejects with its original graphics location',async()=>{
 const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const bytes=await getDocumentXml(input,diagramContext,{part:'/word/document.xml',raw:true}) as Uint8Array;
 const replacement=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('<w:drawing>','<w:t>other</w:t><w:drawing>'));
 await expect(replaceDocumentXmlPart(input,replacement,{part:'/word/document.xml',dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part:'/word/document.xml'}}});
});
it('unchanged diagram resource XML remains a byte no-op',async()=>{const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const bytes=await getDocumentXml(input,diagramContext,{part:'/word/graphs/data.xml',raw:true}) as Uint8Array;const result=await replaceDocumentXmlPart(input,bytes,{part:'/word/graphs/data.xml',dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}});expect(result.changed).toBe(false);expect(result.changes).toEqual([]);});
it('raw diagram owner relationships cannot rebind graph edges without a located rejection',async()=>{
 const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const part='/word/_rels/document.xml.rels';const bytes=await getDocumentXml(input,diagramContext,{part,raw:true}) as Uint8Array;
 const replacement=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('Id="data"','Id="changed"'));
 await expect(replaceDocumentXmlPart(input,replacement,{part,dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part,path:[]}}});
});
it('raw content-type changes to diagram graph roles carry the selected declaration location',async()=>{
 const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const part='/[Content_Types].xml';const bytes=await getDocumentXml(input,diagramContext,{part,raw:true}) as Uint8Array;
 const replacement=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('drawingml.diagramData+xml','drawingml.diagramLayout+xml'));
 await expect(replaceDocumentXmlPart(input,replacement,{part,dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part,path:[]}}});
});
it('unchanged diagram owner relationships remains a no-op',async()=>{const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture();const part='/word/_rels/document.xml.rels';const bytes=await getDocumentXml(input,diagramContext,{part,raw:true}) as Uint8Array;expect((await replaceDocumentXmlPart(input,bytes,{part,dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).changed).toBe(false);});
it('raw mutation of an opaque XML closure resource carries its selected part location',async()=>{
 const {diagramFixture,diagramContext,diagramNamespace}=await import('../tests/fixtures/diagrams.js');const input=await diagramFixture({resources:[{name:'word/data.xml',type:'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml',bytes:'<d:dataModel xmlns:d="'+diagramNamespace+'"/>'},{name:'word/opaque.xml',type:'application/xml',bytes:'<x:opaque xmlns:x="urn:opaque" value="old"/>'}],relationships:[{owner:'/word/document.xml',id:'data',type:r+'/diagramData',target:'data.xml'},{owner:'/word/data.xml',id:'resource',type:r+'/custom',target:'opaque.xml'}]});
 const replacement=new TextEncoder().encode('<x:opaque xmlns:x="urn:opaque" value="new"/>');await expect(replaceDocumentXmlPart(input,replacement,{part:'/word/opaque.xml',dryRun:true},{...diagramContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part:'/word/opaque.xml',path:[]}}});
});

it('existing native diagram binding mutation reports its original relIds source location',async()=>{
 const {diagramFixture,diagramContext}=await import('../tests/fixtures/diagrams.js');const {inspectDocumentDiagrams}=await import('./diagrams.js');const {decodeLocation}=await import('./location-token.js');
 const input=await diagramFixture(),part='/word/document.xml',bytes=await getDocumentXml(input,diagramContext,{part,raw:true}) as Uint8Array;
 const original=(await inspectDocumentDiagrams(input,{},diagramContext)).items.find(item=>item.name===part)!.details.observations.find(observation=>observation.kind==='relIds')!;
 const replacement=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('r:dm="data"','r:dm="layout"'));
 const destination=Volume.fromJSON({'/preserved':Buffer.from([3,8,5])});let writes=0;let error:unknown;
 try{await replaceDocumentXmlPart(input,replacement,{part,output:'-'},{...diagramContext,encoding:{order:'input',compression:'store'},stdout:{async write(chunk){writes++;destination.appendFileSync('/preserved',chunk);}}});}catch(cause){error=cause;}
 expect(error).toMatchObject({code:'unsupported-edit',location:{kind:'part',value:{part,path:original.path,generation:0,range:null}}});
 const token=decodeLocation((error as {location:{token:string}}).location.token);let node=parseDocumentXml(bytes).root;for(const index of token.path)node=node.children[index]!;expect(node.localName).toBe('relIds');expect(token.path).toEqual(original.path);expect(writes).toBe(0);expect(destination.readFileSync('/preserved')).toEqual(Buffer.from([3,8,5]));
});
