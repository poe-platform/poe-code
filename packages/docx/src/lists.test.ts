import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

const attr = (node: docx.XmlElement | undefined, name = "val") => node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
const child = (node: docx.XmlElement | undefined, name: string) => node?.children.find(c => c.namespace === node.namespace && c.localName === name);
const level = (index: number, format = "decimal", start = 1) => `<w:lvl w:ilvl="${index}"><w:start w:val="${start}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${format === 'bullet' ? '•' : '%' + (index + 1) + '.'}"/></w:lvl>`;
const abstract = (id: number, levels = level(0) + level(1, "bullet"), extra = "") => `<w:abstractNum w:abstractNumId="${id}">${extra}${levels}</w:abstractNum>`;
const instance = (id: number, abstractId: number, extra = "") => `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/>${extra}</w:num>`;
const item = (text: string, id = 4, ilvl = 0) => `<w:p><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${id}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
async function fixture(body: string, numbering?: string, styles?: string) {
  return textFixture(body, { ...(numbering === undefined ? {} : { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}">${numbering}</w:numbering>` } }), ...(styles === undefined ? {} : { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${styles}</w:styles>` } }) });
}
async function edit(input: Uint8Array, operation: "lists.add" | "lists.set", options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.editDocumentLists(input, { operation, options: { output: "-", ...options } } as docx.ListEditRequest, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const archive = await docx.readDocumentArchive(bytes, textContext);
  const edge = archive.package.relationships("/" + archive.mainPart).find(e => e.reltype.endsWith("/numbering"));
  const numbering = edge ? docx.parseDocumentXml(edge.target_part.bytes).root : undefined;
  const body = docx.parseDocumentXml(archive.members.find(m => m.name === archive.mainPart)!.bytes).root.children[0]!;
  return { data, bytes, archive, numbering, body };
}
function binding(result: Awaited<ReturnType<typeof edit>>, p: docx.XmlElement) {
  const props = child(child(p, "pPr"), "numPr");
  const num = result.numbering?.children.find(n => n.localName === "num" && attr(n, "numId") === attr(child(props, "numId")));
  const definition = result.numbering?.children.find(n => n.localName === "abstractNum" && attr(n, "abstractNumId") === attr(child(num, "abstractNumId")));
  const ilvl = attr(child(props, "ilvl"));
  const override = num?.children.find(n => n.localName === "lvlOverride" && attr(n, "ilvl") === ilvl);
  return { num, definition, ilvl, level: child(override, "lvl") ?? definition?.children.find(n => n.localName === "lvl" && attr(n, "ilvl") === ilvl), override };
}

it.each([false, true])("creates nine bounded levels and continues a compatible list in its dialect (%s)", async strict => {
  const first = await edit(await textFixture(paragraph("Opening"), {}, strict), "lists.add", { kind: "decimal", text: "First" });
  expect((await docx.extractDocumentText(first.bytes, textContext)).text).toBe("Opening\nFirst");
  const a = binding(first, first.body.children[1]!);
  expect(a.definition?.children.filter(n => n.localName === "lvl").map(n => attr(n, "ilvl"))).toEqual(Array.from({ length: 9 }, (_, i) => String(i)));
  expect(attr(child(a.level, "numFmt"))).toBe("decimal");
  expect(attr(child(a.level, "start"))).toBe("1");
  const second = await edit(first.bytes, "lists.add", { paragraph: 2, kind: "decimal", level: 1, text: "Nested" });
  expect(binding(second, second.body.children[2]!).ilvl).toBe("1");
  expect(attr(binding(second, second.body.children[2]!).num, "numId")).toBe(attr(a.num, "numId"));
  expect(second.archive.dialect).toBe(strict ? "strict" : "transitional");
});

it("restarts selected instances without modifying their abstract definition or unrelated items", async () => {
  const input = await fixture(item("First") + item("Restart here") + item("Separate", 8), abstract(4) + instance(4, 4) + instance(8, 4));
  const result = await edit(input, "lists.set", { paragraph: 2, restart: true, start: 0 });
  const original = binding(result, result.body.children[0]!);
  const restart = binding(result, result.body.children[1]!);
  expect(attr(restart.num, "numId")).not.toBe("4");
  expect(attr(restart.definition, "abstractNumId")).toBe("4");
  expect(attr(child(restart.override, "startOverride"))).toBe("0");
  expect(original.override).toBeUndefined();
  expect(attr(binding(result, result.body.children[2]!).num, "numId")).toBe("8");
  expect(new TextDecoder().decode(result.archive.members.find(m => m.name === "word/numbering.xml")!.bytes)).toContain(abstract(4));
});

it("uses abstract and concrete IDs in separate scopes and preserves mixed levels in nested paragraphs", async () => {
  const input = await fixture(table([item("Nested")]) + item("Outside", 9), abstract(4) + abstract(1, level(0, "upperRoman")) + instance(4, 4) + instance(9, 1));
  const result = await edit(input, "lists.set", { table: 1, cell: "A1", paragraph: 1, level: 1 });
  const nested = result.body.children[0]!.children.at(-1)!.children[0]!.children[0]!;
  expect(attr(child(binding(result, nested).level, "numFmt"))).toBe("bullet");
  expect(attr(child(binding(result, result.body.children[1]!).level, "numFmt"))).toBe("upperRoman");
});

it("resolves inherited paragraph numbering and numbering style links without modifying styles", async () => {
  const styles = '<w:style w:type="paragraph" w:styleId="Steps"><w:name w:val="Steps"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style><w:style w:type="numbering" w:styleId="Sequence"><w:name w:val="Sequence"/><w:pPr><w:numPr><w:numId w:val="8"/></w:numPr></w:pPr></w:style>';
  const input = await fixture('<w:p><w:pPr><w:pStyle w:val="Steps"/></w:pPr>' + run("Inherited") + '</w:p>', abstract(2, '', '<w:numStyleLink w:val="Sequence"/>') + abstract(3) + instance(4, 2) + instance(8, 3), styles);
  const result = await edit(input, "lists.set", { paragraph: 1, restart: true, start: 7, level: 1 });
  const bound = binding(result, result.body.children[0]!);
  expect(attr(bound.definition, "abstractNumId")).toBe("3");
  expect(attr(child(bound.override, "startOverride"))).toBe("7");
  expect(new TextDecoder().decode(result.archive.members.find(m => m.name === "word/styles.xml")!.bytes)).toContain(styles);
});

it.each([
  [abstract(1) + instance(4, 99), "missing"],
  [abstract(1) + instance(4, 1) + instance(4, 1), "duplicate"],
  [abstract(1, level(0, "chicago")) + instance(4, 1), "unsupported"],
  [abstract(1, level(0) + '<w:lvl w:ilvl="1"><w:lvlPicBulletId w:val="2"/></w:lvl>') + instance(4, 1), "picture"]
])("rejects affected ambiguous or opaque numbering before publication: case %#", async (numbering, reason) => {
  await expect(edit(await fixture(item("Keep"), numbering), "lists.set", { paragraph: 1, restart: true })).rejects.toMatchObject({ code: ["missing", "duplicate"].includes(reason!) ? "invalid-package" : "unsupported-edit" });
});

it("bounds item selection and rejects missing target levels", async () => {
  const input = await fixture(item("One") + item("Two"), abstract(1, level(0)) + instance(4, 1));
  await expect(edit(input, "lists.set", { paragraph: 1, level: 8 })).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(edit(input, "lists.set", { all: true, restart: true, limit: [{ name: "matches", value: 1 }] })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("reuses only a complete matching definition, allocates separate instances for explicit starts", async () => {
  const first = await edit(await fixture(paragraph("Heading")), "lists.add", { kind: "lowerLetter", text: "Alpha" });
  const second = await edit(first.bytes, "lists.add", { paragraph: 1, kind: "lowerLetter", start: 5, text: "Reset" });
  const a = binding(second, second.body.children[1]!), b = binding(second, second.body.children[2]!);
  expect(attr(a.definition, "abstractNumId")).toBe(attr(b.definition, "abstractNumId"));
  expect(attr(a.num, "numId")).not.toBe(attr(b.num, "numId"));
  expect(attr(child(a.override, "startOverride"))).toBe("5");
  const custom = await edit(await fixture(paragraph("Heading") + item("Existing"), abstract(0, level(0, "lowerLetter")) + instance(4, 0)), "lists.add", { paragraph: 1, kind: "lowerLetter", start: 5 });
  expect(attr(binding(custom, custom.body.children[1]!).definition, "abstractNumId")).not.toBe("0");
});

it("retains complete level overrides and separates grouped restart instances", async () => {
  const override = '<w:lvlOverride w:ilvl="1"><w:startOverride w:val="3"/>' + level(1, "upperRoman", 6) + '</w:lvlOverride>';
  const result = await edit(await fixture(item("One", 4, 1) + item("Two", 4, 1) + item("Three", 5, 1), abstract(0) + instance(4, 0, override) + instance(5, 0)), "lists.set", { all: true, restart: true });
  const bound = result.body.children.map(p => binding(result, p));
  expect(attr(bound[0]!.num, "numId")).toBe(attr(bound[1]!.num, "numId"));
  expect(attr(bound[0]!.num, "numId")).not.toBe(attr(bound[2]!.num, "numId"));
  expect(attr(child(bound[0]!.level, "numFmt"))).toBe("upperRoman");
  expect(attr(child(bound[0]!.override, "startOverride"))).toBe("6");
});

it("retains list-reference comments and reads default paragraph-style numbering", async () => {
  const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>';
  const source = '<w:p><w:pPr><w:numPr><!--retain reference--><w:ilvl w:val="0"/></w:numPr></w:pPr>' + run("Styled") + '</w:p>';
  const result = await edit(await fixture(source, abstract(0) + instance(4, 0), styles), "lists.set", { paragraph: 1, level: 1 });
  expect(binding(result, result.body.children[0]!).ilvl).toBe("1");
  expect(new TextDecoder().decode(result.archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain('<!--retain reference-->');
});

it("preserves unrelated opaque numbering and picture-bullet definitions", async () => {
  const opaque = '<w:numPicBullet w:numPicBulletId="6"><w:drawing/></w:numPicBullet>' + abstract(2, '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlPicBulletId w:val="6"/><w:lvlText w:val=""/></w:lvl>') + abstract(3, level(0, "chicago")) + instance(8, 2) + instance(9, 3);
  const source = await fixture(paragraph("Plain") + item("Picture", 8) + item("Opaque", 9), opaque);
  const result = await edit(source, "lists.add", { paragraph: 1, kind: "bullet", text: "New" });
  const numberingXml = new TextDecoder().decode(result.archive.members.find(m => m.name === "word/numbering.xml")!.bytes);
  for (const element of docx.parseDocumentXml(new TextEncoder().encode(`<w:numbering xmlns:w="${w}">${opaque}</w:numbering>`)).root.children) {
    const old = new docx.DocumentXmlEditor(new TextEncoder().encode(`<w:numbering xmlns:w="${w}">${opaque}</w:numbering>`));
    const matching = old.root.children.find(n => n.localName === element.localName && attr(n, element.localName === 'num' ? 'numId' : element.localName === 'numPicBullet' ? 'numPicBulletId' : 'abstractNumId') === attr(element, element.localName === 'num' ? 'numId' : element.localName === 'numPicBullet' ? 'numPicBulletId' : 'abstractNumId'))!;
    expect(numberingXml).toContain(old.sourceXml(matching));
  }
  expect(attr(binding(result, result.body.children[2]!).num, "numId")).toBe("8");
});

it("rejects style cycles, level mismatches and stale locations", async () => {
  const styles = '<w:style w:type="numbering" w:styleId="Cycle"><w:name w:val="Cycle"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>';
  await expect(edit(await fixture(item("Cycle"), abstract(0, '', '<w:numStyleLink w:val="Cycle"/>') + instance(4, 0), styles), "lists.set", { paragraph: 1, restart: true })).rejects.toMatchObject({ code: "invalid-package" });
  await expect(edit(await fixture(item("Mismatch"), abstract(0) + instance(4, 0, '<w:lvlOverride w:ilvl="0">' + level(1) + '</w:lvlOverride>')), "lists.set", { paragraph: 1, restart: true })).rejects.toMatchObject({ code: "unsupported-edit" });
  const first = await edit(await fixture(paragraph("Plain")), "lists.add", { kind: "decimal" });
  const stale = (await docx.openDocumentLocations(first.bytes, textContext)).at("paragraph", 2).token;
  const second = await edit(first.bytes, "lists.add", { paragraph: 2, kind: "decimal" });
  await expect(edit(second.bytes, "lists.set", { select: stale, level: 1 })).rejects.toMatchObject({ code: "stale-selection" });
});

it("executes lists through the command engine with SDK parity and explicit schema support", async () => {
  const input = await fixture(paragraph("Heading"));
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  let stderr = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["lists", "add", "/input", "--kind", "decimal", "--text", "First", "--output", "-"].map(v => new TextEncoder().encode(v)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ code: result.exitCode, stderr }).toEqual({ code: 0, stderr: "" });
  const sdk = await edit(input, "lists.add", { kind: "decimal", text: "First" });
  expect(new Uint8Array(volume.readFileSync("/output") as Buffer)).toEqual(sdk.bytes);
  const schema = docx.getDocxDiscovery(docx.parseDocxArguments(["schema", "lists", "set"].map(v => new TextEncoder().encode(v))))!;
  expect(JSON.stringify(schema.data)).toContain('"support":"edit"');
});

it("resolves paragraph styles associated with a numbering level", async () => {
  const styles = '<w:style w:type="paragraph" w:styleId="Detail"><w:name w:val="Detail"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>';
  const detail = '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:pStyle w:val="Detail"/><w:lvlText w:val="%2)"/></w:lvl>';
  const input = await fixture('<w:p><w:pPr><w:pStyle w:val="Detail"/></w:pPr>' + run("Detail") + '</w:p>', abstract(0, level(0) + detail) + instance(4, 0), styles);
  const result = await edit(input, "lists.set", { paragraph: 1, restart: true });
  expect(binding(result, result.body.children[0]!).ilvl).toBe("1");
});

it("merges linked instance start overrides with inherited full level formatting", async () => {
  const styles = '<w:style w:type="numbering" w:styleId="Linked"><w:name w:val="Linked"/><w:pPr><w:numPr><w:numId w:val="8"/></w:numPr></w:pPr></w:style>';
  const input = await fixture(item("Linked"), abstract(0, '', '<w:numStyleLink w:val="Linked"/>') + abstract(1) + instance(4, 0, '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="9"/></w:lvlOverride>') + instance(8, 1, '<w:lvlOverride w:ilvl="0">' + level(0, "upperLetter", 4) + '</w:lvlOverride>'), styles);
  const result = await edit(input, "lists.set", { paragraph: 1, restart: true, start: 2 });
  const bound = binding(result, result.body.children[0]!);
  expect(attr(child(bound.level, "numFmt"))).toBe("upperLetter");
  expect(attr(child(bound.override, "startOverride"))).toBe("2");
});

it("preserves numbering declarations, prolog, cleanup metadata and epilog", async () => {
  const source = await textFixture(paragraph("Plain"), { numbering: { kind: "numbering", xml: `<?xml version="1.0"?><!--before--><w:numbering xmlns:w="${w}">${abstract(0)}${instance(4, 0)}<w:numIdMacAtCleanup w:val="90"/></w:numbering><!--after-->` } });
  const result = await edit(source, "lists.add", { kind: "bullet" });
  const bytes = result.archive.members.find(m => m.name === "word/numbering.xml")!.bytes;
  const xml = new TextDecoder().decode(bytes);
  expect(xml.startsWith('<?xml version="1.0"?><!--before-->')).toBe(true);
  expect(xml.endsWith('<!--after-->')).toBe(true);
  expect(result.numbering?.children.at(-1)?.localName).toBe("numIdMacAtCleanup");
});

it("shows applicable list selectors and usable defaults in help", () => {
  const help = (action: string) => docx.getDocxDiscovery(docx.parseDocxArguments(["lists", action, "--help"].map(v => new TextEncoder().encode(v))))!.human;
  expect(help("add")).not.toContain("--all ");
  expect(help("add")).not.toContain("--image ");
  expect(help("set")).toContain("--all ");
  expect(help("add")).toContain("start 1");
});

it("preserves picture-bullet media and its numbering-part relationship bytes", async () => {
  const picture = `<w:numPicBullet w:numPicBulletId="6"><w:pict xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><v:shape><v:imagedata r:id="glyph"/></v:shape></w:pict></w:numPicBullet>`;
  const input = await fixture(paragraph("Plain"), picture);
  const archive = await docx.readDocumentArchive(input, textContext);
  const types = archive.members.find(m => m.name === "[Content_Types].xml")!;
  const typesXml = new docx.DocumentXmlEditor(types.bytes);
  typesXml.insertChildren(typesXml.root, '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="png" ContentType="image/png"/>');
  const media = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==", "base64"));
  const rels = new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="glyph" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/glyph.png"/></Relationships>');
  const volume = Volume.fromJSON({ "/fixture": "" });
  await docx.writeArchive({ ...archive, members: [...archive.members.map(m => m === types ? { ...m, bytes: typesXml.serialize() } : m),
    { name: "word/media/glyph.png", bytes: media, directory: false, modified: new Date("1980-01-01T00:00:00Z") },
    { name: "word/_rels/numbering.xml.rels", bytes: rels, directory: false, modified: new Date("1980-01-01T00:00:00Z") }] },
    { async write(bytes) { volume.appendFileSync("/fixture", bytes); } }, { order: "input", compression: "store" }, textContext);
  const result = await edit(new Uint8Array(volume.readFileSync("/fixture") as Buffer), "lists.add", { kind: "decimal" });
  const edge = result.archive.package.relationships("/word/numbering.xml").find(e => e.rId === "glyph");
  expect(edge?.target_part.partname).toBe("/word/media/glyph.png");
  expect(edge?.target_part.bytes).toEqual(media);
  expect(result.archive.members.find(m => m.name === "word/_rels/numbering.xml.rels")!.bytes).toEqual(rels);
  expect(new TextDecoder().decode(result.archive.members.find(m => m.name === "word/numbering.xml")!.bytes)).toContain(picture);
});

it("keeps selected nested levels on one restarted instance", async () => {
  const input = await fixture(item("Outer") + item("Nested", 4, 1), abstract(0) + instance(4, 0));
  const result = await edit(input, "lists.set", { all: true, restart: true, start: 3 });
  const outer = binding(result, result.body.children[0]!), nested = binding(result, result.body.children[1]!);
  expect(attr(outer.num, "numId")).toBe(attr(nested.num, "numId"));
  expect(attr(child(outer.override, "startOverride"))).toBe("3");
  expect(attr(child(nested.override, "startOverride"))).toBe("3");
  expect(attr(child(nested.level, "numFmt"))).toBe("bullet");
});

it("creates a mixed ordered and bullet list without changing a level already used by existing items", async () => {
  const first = await edit(await fixture(paragraph("Outline")), "lists.add", { kind: "decimal", text: "Outer" });
  const mixed = await edit(first.bytes, "lists.add", { paragraph: 2, kind: "bullet", level: 1, text: "Nested bullet" });
  const outer = binding(mixed, mixed.body.children[1]!), inner = binding(mixed, mixed.body.children[2]!);
  expect(attr(outer.num, "numId")).toBe(attr(inner.num, "numId"));
  expect(attr(child(outer.level, "numFmt"))).toBe("decimal");
  expect(attr(child(inner.level, "numFmt"))).toBe("bullet");
  const another = await edit(mixed.bytes, "lists.add", { paragraph: 3, kind: "lowerLetter", level: 2, text: "Deep item" });
  expect(attr(binding(another, another.body.children[3]!).num, "numId")).toBe(attr(outer.num, "numId"));
  const separate = await edit(another.bytes, "lists.add", { paragraph: 3, kind: "upperRoman", level: 1, text: "Separate" });
  expect(attr(binding(separate, separate.body.children[3]!).num, "numId")).not.toBe(attr(outer.num, "numId"));
  expect(attr(child(binding(separate, separate.body.children[2]!).level, "numFmt"))).toBe("bullet");
});

it("isolates mixed-level authoring from other instances sharing the original abstract", async () => {
  const first = await edit(await fixture(paragraph("Outline")), "lists.add", { kind: "decimal", text: "Outer" });
  const shared = await edit(first.bytes, "lists.add", { paragraph: 1, kind: "decimal", start: 1, text: "Separate" });
  const mixed = await edit(shared.bytes, "lists.add", { paragraph: 3, kind: "bullet", level: 1, text: "Nested" });
  const untouched = binding(mixed, mixed.body.children[1]!), outer = binding(mixed, mixed.body.children[2]!);
  expect(attr(untouched.definition, "abstractNumId")).not.toBe(attr(outer.definition, "abstractNumId"));
  expect(attr(child(untouched.definition?.children.find(n => attr(n, "ilvl") === "1"), "numFmt"))).toBe("decimal");
  expect(attr(child(binding(mixed, mixed.body.children[3]!).level, "numFmt"))).toBe("bullet");
});

it("rejects unverified numbering attributes instead of guessing their counter semantics", async () => {
  const input = await fixture(item("Extended"), '<w:abstractNum w:abstractNumId="0" xmlns:q="urn:counter-policy" q:restart="always">' + level(0) + '</w:abstractNum>' + instance(4, 0));
  await expect(edit(input, "lists.set", { paragraph: 1, restart: true }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each([
  '<w:startOverride xmlns:q="urn:counter-policy" w:val="9" q:restart="always"/>',
  '<w:startOverride w:val="9"><q:counter xmlns:q="urn:counter-policy"/></w:startOverride>'
])("preserves opaque start overrides and rejects affected restarts: case %#", async start => {
  const opaque = instance(4, 0, '<w:lvlOverride w:ilvl="0">' + start + '</w:lvlOverride>');
  const input = await fixture(item("Opaque counter") + item("Ordinary counter", 8), abstract(0) + opaque + instance(8, 0));
  const unrelated = await edit(input, "lists.set", { paragraph: 2, restart: true, start: 2 });
  expect(new TextDecoder().decode(unrelated.archive.members.find(m => m.name === "word/numbering.xml")!.bytes)).toContain(opaque);
  expect(attr(binding(unrelated, unrelated.body.children[0]!).num, "numId")).toBe("4");
  expect(attr(child(binding(unrelated, unrelated.body.children[1]!).override, "startOverride"))).toBe("2");
  await expect(edit(input, "lists.set", { paragraph: 1, restart: true, start: 2 }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
