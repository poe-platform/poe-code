import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  createDocumentArchive, documentDialects, DocumentXmlEditor, DocumentArchiveEditor,
  readDocumentArchive, writeArchive, parseDocumentXml,
  type ArchiveContext, type DocumentArchive
} from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";

const context: ArchiveContext = {
  signal: new AbortController().signal,
  limits: {
    maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 60000,
    maxMembers: 40, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0,
    maxCommentBytes: 0, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512
  }
};
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const w = {
  strict: "http://purl.oclc.org/ooxml/wordprocessingml/main",
  transitional: "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
};
const r = {
  strict: "http://purl.oclc.org/ooxml/officeDocument/relationships",
  transitional: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
};
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
type Dialect = keyof typeof w;

async function bytesFor(archive: DocumentArchive): Promise<Uint8Array> {
  const volume = Volume.fromJSON({ "/result": "" });
  await writeArchive(archive, { async write(bytes) { volume.appendFileSync("/result", bytes); } },
    { order: "name", compression: "store" }, context);
  return new Uint8Array(volume.readFileSync("/result") as Buffer);
}

async function changedFixture(dialect: Dialect, change: (parts: Map<string, Uint8Array>) => void) {
  const { parts } = await createDocumentFixture("observatory", dialect === "strict" ? "strict" : "valid");
  change(parts);
  return bytesFor({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({
    name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z")
  })) });
}

it.each(["strict", "transitional"] as const)("rejects %s main relationship/namespace disagreement", async dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  const bytes = await changedFixture(dialect, parts => {
    parts.set("_rels/.rels", encode(`<Relationships xmlns="${pr}"><Relationship Id="rMain" Type="${r[other]}/officeDocument" Target="word/document.xml"/></Relationships>`));
  });
  await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
    code: "invalid-package", message: "The main relationship dialect disagrees with the document namespace."
  });
});

it.each(["strict", "transitional"] as const)("rejects mixed %s related-part namespaces and relationships", async dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  for (const relationship of [false, true]) {
    const bytes = await changedFixture(dialect, parts => {
      if (relationship) parts.set("word/_rels/header1.xml.rels", encode(`<Relationships xmlns="${pr}"><Relationship Id="rLink" Type="${r[other]}/hyperlink" Target="https://inert.invalid/" TargetMode="External"/></Relationships>`));
      else parts.set("word/header1.xml", encode(`<q:hdr xmlns:q="${w[other]}"><q:p/></q:hdr>`));
    });
    await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
      code: "invalid-package", message: relationship
        ? "A package relationship uses the opposite document dialect."
        : "A document part root uses the opposite document dialect."
    });
  }
});

it.each(["strict", "transitional"] as const)("rejects %s active mixed elements and attributes", async dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  for (const body of ["<z:p/>", '<q:p z:rsidR="12345678"/>', '<q:p><q:hyperlink rr:id="rLink"/></q:p>']) {
    const bytes = await changedFixture(dialect, parts => {
      parts.set("word/document.xml", encode(`<q:document xmlns:q="${w[dialect]}" xmlns:z="${w[other]}" xmlns:rr="${r[other]}"><q:body>${body}</q:body></q:document>`));
    });
    await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
      code: "invalid-package", message: "Active XML uses a namespace from the opposite document dialect."
    });
  }
});

it.each(["strict", "transitional"] as const)("rejects invalid %s document roots and body cardinality", async dialect => {
  for (const xml of [
    `<q:hdr xmlns:q="${w[dialect]}"/>`,
    `<q:document xmlns:q="${w[dialect]}"/>`,
    `<q:document xmlns:q="${w[dialect]}"><q:body/><q:body/></q:document>`
  ]) {
    const bytes = await changedFixture(dialect, parts => { parts.set("word/document.xml", encode(xml)); });
    await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({ code: "invalid-package" });
  }
});

it.each(["strict", "transitional"] as const)("preserves %s inactive alternate content and opaque payloads", async dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  const opaque = `<x:record><z:p xmlns:z="${w[other]}">opaque</z:p></x:record>`;
  const alternate = `<mc:AlternateContent><mc:Choice Requires="x"><z:p xmlns:z="${w[other]}"><v:shape xmlns:v="urn:schemas-microsoft-com:vml"/></z:p></mc:Choice><mc:Fallback><q:p/></mc:Fallback></mc:AlternateContent>`;
  const xml = `<q:document xmlns:q="${w[dialect]}" xmlns:mc="${mc}" xmlns:x="urn:original:opaque" mc:Ignorable="x"><q:body><q:p><q:r><q:t>Harbor log</q:t></q:r></q:p>${opaque}${alternate}</q:body></q:document>`;
  const bytes = await changedFixture(dialect, parts => { parts.set("word/document.xml", encode(xml)); });
  const admitted = await readDocumentArchive(bytes, context);
  const editor = new DocumentArchiveEditor(admitted);
  const part = editor.xml(admitted.mainPart);
  const text = part.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!;
  part.setText(text, "Harbor notes");
  expect(decode(part.serialize())).toBe(xml.replace("Harbor log", "Harbor notes"));
  const reopened = await readDocumentArchive(await bytesFor(editor.snapshot()), context);
  expect(reopened.dialect).toBe(dialect);
  for (const member of admitted.members) if (member.name !== admitted.mainPart)
    expect(reopened.members.find(part => part.name === member.name)!.bytes).toEqual(member.bytes);
});

it.each(["strict", "transitional"] as const)("maps every XML editing primitive in %s without prefix rewriting", async dialect => {
  const xml = `<?xml version="1.0"?><!--cover--><q:document xmlns:q="${w[dialect]}" xmlns:mc="${mc}" xmlns:x="urn:original:opaque" mc:Ignorable="x"><q:body><q:p q:rsidR='01020304'><q:r><q:t>Harbor &amp; bay</q:t><q:t><![CDATA[raw tide]]></q:t></q:r><!--note--><?review open?></q:p><x:record flag='exact'>untouched</x:record></q:body></q:document>`;
  const bytes = await changedFixture(dialect, parts => { parts.set("word/document.xml", encode(xml)); });
  const admitted = await readDocumentArchive(bytes, context);
  const editor = new DocumentArchiveEditor(admitted);
  const part = editor.xml(admitted.mainPart);
  const paragraph = part.root.children[0]!.children[0]!;
  const run = paragraph.children[0]!;
  part.setAttribute(paragraph, "q:rsidR", "11121314");
  part.setText(run.children[0]!.content[0]!, "Coast <&>");
  part.setText(run.children[1]!.content[0]!, "raw swell");
  part.setText(paragraph.content[1]!, "revised note");
  part.setText(paragraph.content[2]!, "closed");
  part.setAttribute(paragraph, { namespace: documentDialects[dialect].w, localName: "rsidR" }, "05060708");
  expect(decode(part.serialize())).toBe(xml.replace("Harbor &amp; bay", "Coast &lt;&amp;&gt;")
    .replace("raw tide", "raw swell").replace("<!--note-->", "<!--revised note-->")
    .replace("<?review open?>", "<?review closed?>").replace("01020304", "05060708"));
  const reopened = await readDocumentArchive(await bytesFor(editor.snapshot()), context);
  expect(reopened.dialect).toBe(dialect);
  expect(documentDialects[dialect].r).toBe(r[dialect]);
  expect(Object.isFrozen(documentDialects[dialect])).toBe(true);
  const before = part.serialize();
  const other = dialect === "strict" ? "transitional" : "strict";
  expect(() => part.setAttribute(paragraph, { namespace: w[other], localName: "rsidR" }, "bad")).toThrow();
  expect(part.serialize()).toEqual(before);
});

it("rejects active Strict VML while retaining Transitional VML opaquely", async () => {
  for (const dialect of ["strict", "transitional"] as const) {
    const xml = `<q:document xmlns:q="${w[dialect]}" xmlns:v="urn:schemas-microsoft-com:vml"><q:body><q:p><q:r><q:t>Dock</q:t><q:pict><v:shape id="unchanged"/></q:pict></q:r></q:p></q:body></q:document>`;
    const bytes = await changedFixture(dialect, parts => { parts.set("word/document.xml", encode(xml)); });
    if (dialect === "strict") {
      await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
        code: "invalid-package", message: "Active legacy markup is not valid in the Strict dialect."
      });
    } else {
      const admitted = await readDocumentArchive(bytes, context);
      const editor = new DocumentArchiveEditor(admitted).xml(admitted.mainPart);
      const run = editor.root.children[0]!.children[0]!.children[0]!;
      editor.setText(run.children[0]!.content[0]!, "Pier");
      expect(() => editor.setAttribute(run.children[1]!.children[0]!, "id", "changed")).toThrow();
      expect(decode(editor.serialize())).toBe(xml.replace("Dock", "Pier"));
    }
  }
});

it.each(["strict", "transitional"] as const)("refuses standalone mixed %s XML edits without changing source", dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  const xml = `<q:document xmlns:q="${w[dialect]}" xmlns:z="${w[other]}"><q:body><q:p><q:r><q:t>Keep</q:t></q:r></q:p><z:p/></q:body></q:document>`;
  const editor = new DocumentXmlEditor(encode(xml));
  expect(() => editor.setText(editor.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "Change")).toThrow();
  expect(editor.serialize()).toEqual(encode(xml));
});

it.each(["strict", "transitional"] as const)("creates explicit %s packages with neutral deterministic defaults", async dialect => {
  for (const kind of ["docx", "dotx"] as const) {
    const archive = await createDocumentArchive({ dialect, kind }, context);
    const bytes = await bytesFor(archive);
    expect(await bytesFor(await createDocumentArchive({ dialect, kind }, context))).toEqual(bytes);
    const admitted = await readDocumentArchive(bytes, context);
    expect(admitted.dialect).toBe(dialect);
    expect(admitted.kind).toBe(kind);
    const root = parseDocumentXml(admitted.package.getPart("/" + admitted.mainPart).bytes).root;
    expect(root.namespace).toBe(w[dialect]);
    const body = root.children[0]!;
    expect(body.children.map(node => node.localName)).toEqual(["p", "sectPr"]);
    expect(body.children[0]!.children).toEqual([]);
    expect(body.children[1]!.children[0]!.attributes.map(a => [a.localName, a.value])).toEqual([["w", "12240"], ["h", "15840"]]);
    const styles = admitted.package.relationships("/" + admitted.mainPart).find(edge => edge.reltype === `${r[dialect]}/styles`)!;
    expect(parseDocumentXml(styles.target_part.bytes).root.namespace).toBe(w[dialect]);
    expect(decode(styles.target_part.bytes)).toContain('w:styleId="Normal"');
    expect(admitted.members.some(member => member.name.startsWith("docProps/"))).toBe(false);
  }
});

it("defaults new packages to Transitional and rejects invalid dialect options", async () => {
  expect((await createDocumentArchive({}, context)).dialect).toBe("transitional");
  for (const options of [null, { dialect: null }, { dialect: "Strict" }, { dialect: "" }, { dialect: 1 }, { unexpected: true }, { kind: "docm" }])
    await expect(createDocumentArchive(options as never, context)).rejects.toMatchObject({ code: "usage" });
  await expect(createDocumentArchive({}, { ...context, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "cancelled" });
  await expect(createDocumentArchive({}, { ...context, limits: { ...context.limits, maxMembers: 1 } })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it.each(["strict", "transitional"] as const)("detects %s despite misleading extensions and unused opposite declarations", async dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  const bytes = await changedFixture(dialect, parts => {
    parts.set("word/main.dotx", encode(`<document xmlns="${w[dialect]}" xmlns:unused="${w[other]}"><body><p/></body></document>`));
    parts.delete("word/document.xml");
    parts.delete("word/_rels/document.xml.rels");
    parts.set("_rels/.rels", encode(`<Relationships xmlns="${pr}"><Relationship Id="rMain" Type="${r[dialect]}/officeDocument" Target="word/main.dotx"/></Relationships>`));
    parts.set("[Content_Types].xml", encode(`<Types xmlns="${ct}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/main.dotx" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`));
  });
  expect(await readDocumentArchive(bytes, context)).toMatchObject({ dialect, kind: "docx", mainPart: "word/main.dotx" });
});

it.each(["strict", "transitional"] as const)("rejects %s related Word parts with incompatible content types", async dialect => {
  const bytes = await changedFixture(dialect, parts => {
    const types = decode(parts.get("[Content_Types].xml")!);
    parts.set("[Content_Types].xml", encode(types.replace(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml", "application/xml")));
  });
  await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
    code: "invalid-package", message: "A WordprocessingML relationship target has an incompatible content type."
  });
});

it.each(["strict", "transitional"] as const)("checks %s active drawing namespaces and graphic-data identifiers", async dialect => {
  const other = dialect === "strict" ? "transitional" : "strict";
  for (const body of [
    `<a:graphic xmlns:a="${documentDialects[other].a}"/>`,
    `<a:graphic xmlns:a="${documentDialects[dialect].a}"><a:graphicData uri="${documentDialects[other].pic}"/></a:graphic>`,
    `<mc:AlternateContent><mc:Choice Requires="q"><z:p xmlns:z="${w[other]}"/></mc:Choice><mc:Fallback><q:p/></mc:Fallback></mc:AlternateContent>`
  ]) {
    const bytes = await changedFixture(dialect, parts => {
      parts.set("word/document.xml", encode(`<q:document xmlns:q="${w[dialect]}" xmlns:mc="${mc}"><q:body>${body}</q:body></q:document>`));
    });
    await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
      code: "invalid-package", message: "Active XML uses a namespace from the opposite document dialect."
    });
  }
});

it("rejects a staged graphic-data dialect change and retains preceding edits", () => {
  const xml = `<w:document xmlns:w="${w.strict}" xmlns:a="${documentDialects.strict.a}"><w:body><w:p><w:r><w:t>Dock</w:t><w:drawing><a:graphic><a:graphicData uri="${documentDialects.strict.pic}"/></a:graphic></w:drawing></w:r></w:p></w:body></w:document>`;
  const editor = new DocumentXmlEditor(encode(xml));
  const run = editor.root.children[0]!.children[0]!.children[0]!;
  editor.setText(run.children[0]!.content[0]!, "Pier");
  expect(() => editor.setAttribute(run.children[1]!.children[0]!.children[0]!, "uri", documentDialects.transitional.pic)).toThrow();
  expect(decode(editor.serialize())).toBe(xml.replace("Dock", "Pier"));
});

it("does not mistake an opaque relationship suffix for the main document relationship", async () => {
  const bytes = await changedFixture("strict", parts => {
    parts.set("_rels/.rels", encode(`<Relationships xmlns="${pr}"><Relationship Id="rOpaque" Type="urn:original:officeDocument/officeDocument" Target="word/document.xml"/><Relationship Id="rMain" Type="${r.strict}/officeDocument" Target="word/document.xml"/></Relationships>`));
  });
  expect((await readDocumentArchive(bytes, context)).dialect).toBe("strict");
});

it.each([
  ["", "The package must contain exactly one main document relationship."],
  [`<Relationship Id="r1" Type="${r.strict}/officeDocument" Target="word/document.xml"/><Relationship Id="r2" Type="${r.transitional}/officeDocument" Target="word/document.xml"/>`, "The package must contain exactly one main document relationship."],
  [`<Relationship Id="r1" Type="${r.strict}/officeDocument" Target="https://inert.invalid/" TargetMode="External"/>`, "The main document relationship must be internal and have no fragment."],
  [`<Relationship Id="r1" Type="${r.strict}/officeDocument" Target="word/document.xml#body"/>`, "The main document relationship must be internal and have no fragment."]
])("diagnoses main relationship cardinality and target mode %#", async (edges, message) => {
  const bytes = await changedFixture("strict", parts => {
    parts.set("_rels/.rels", encode(`<Relationships xmlns="${pr}">${edges}</Relationships>`));
  });
  await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({ code: "invalid-package", message });
});
