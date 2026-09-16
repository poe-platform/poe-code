import { afterEach, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture, w, r } from "../tests/fixtures/text.js";

afterEach(() => vi.unstubAllGlobals());
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
async function edit(input: Uint8Array, operation: "links.add" | "links.set" | "links.remove", options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.editDocumentLinks(input, { operation, options: { output: "-", ...options } } as docx.LinkEditRequest,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  return { data, bytes, archive: await docx.readDocumentArchive(bytes, textContext) };
}
async function existing(body: string, owner = "document", strict = false, target = "https://coast.invalid/map?a=1&amp;b=2#bay") {
  const header = owner === "header";
  const initial = await textFixture(header ? paragraph("Body") + '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>' : body,
    header ? { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}" xmlns:r="${r}">${body}</w:hdr>` } } : {}, strict);
  const archive = await docx.readDocumentArchive(initial, textContext);
  const name = `word/_rels/${owner}.xml.rels`;
  const members = archive.members.filter(m => m.name !== name);
  const relNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  members.push({ name, directory: false, modified: new Date("1980-01-01T00:00:00Z"), bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="shared" Type="${relNamespace}/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`) });
  const volume = Volume.fromJSON({ "/fixture": "" });
  await docx.writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/fixture", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/fixture") as Buffer);
}
const styled = '<w:r><w:rPr><w:b/><w:color w:val="248064"/></w:rPr><w:t>Coastal</w:t></w:r>' + run(" guide");
const link = (content = styled) => `<w:hyperlink r:id="shared" w:history="0">${content}</w:hyperlink>`;

it.each([false, true])("creates and lists inert links without fetching, in the input dialect (%s)", async strict => {
  const fetch = vi.fn(() => { throw new Error("External execution forbidden"); });
  vi.stubGlobal("fetch", fetch);
  const result = await edit(await textFixture(paragraph("Read "), {}, strict), "links.add", { paragraph: 1, text: "Coast & bay", target: "https://coast.invalid/a%20b?x=1&y=2#map" });
  expect((await docx.extractDocumentText(result.bytes, textContext)).text).toBe("Read Coast & bay");
  const listed = await docx.inspectDocumentLinks(result.bytes, {}, textContext);
  expect(listed.items).toHaveLength(1);
  expect(listed.items[0]).toMatchObject({ text: "Coast & bay", address: "https://coast.invalid/a%20b?x=1&y=2#map", fragment: "", url: "https://coast.invalid/a%20b?x=1&y=2#map" });
  expect(result.archive.dialect).toBe(strict ? "strict" : "transitional");
  expect(fetch).not.toHaveBeenCalled();
});

it.each([["document", false], ["header", false], ["document", true], ["header", true]] as const)("edits styled label runs and shared relationships only in their owner: %s/%s", async (owner, strict) => {
  const input = await existing(`<w:p>${link()}${link(run("Other"))}</w:p>`, owner, strict);
  const options = owner === "header" ? { scope: "headers" as const } : {};
  const result = await edit(input, "links.set", { ...options, link: 1, target: "mailto:team@coast.invalid?subject=Survey%20notes" });
  const xml = decode(result.archive.members.find(m => m.name === `word/${owner}.xml`)!.bytes);
  expect(xml).toContain(styled);
  expect(xml).toContain('w:history="0"');
  const edges = result.archive.package.relationships(`/word/${owner}.xml`);
  expect(edges.filter(e => e.reltype.endsWith("/hyperlink"))).toHaveLength(2);
  expect(edges.find(e => e.rId === "shared")!.target_ref).toBe("https://coast.invalid/map?a=1&b=2#bay");
  expect((await docx.inspectDocumentLinks(result.bytes, options, textContext)).items.map(i => i.address)).toEqual(["mailto:team@coast.invalid?subject=Survey%20notes", "https://coast.invalid/map?a=1&b=2#bay"]);
  if (owner === "header") expect(result.archive.members.find(m => m.name === "word/_rels/document.xml.rels")!.bytes).toEqual((await docx.readDocumentArchive(input, textContext)).members.find(m => m.name === "word/_rels/document.xml.rels")!.bytes);
});

it.each(["javascript:alert(1)", "file:///never-read", "data:text/plain,private"])("lists and unwraps an existing unsafe address as inert data: %s", async target => {
  const fetch = vi.fn(() => { throw new Error("External execution forbidden"); });
  vi.stubGlobal("fetch", fetch);
  const input = await existing(`<w:p>${link()}</w:p>`, "document", false, target);
  expect((await docx.inspectDocumentLinks(input, {}, textContext)).items[0]!.address).toBe(target);
  const result = await edit(input, "links.remove", { link: 1 });
  expect((await docx.extractDocumentText(result.bytes, textContext)).text).toBe("Coastal guide");
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects mutation of a multiply owned header and reads it once", async () => {
  const section = '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>';
  const input = await textFixture('<w:p><w:pPr>' + section + '</w:pPr></w:p>' + section, { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:hyperlink w:anchor="Overview">${run("Shared")}</w:hyperlink></w:p></w:hdr>` } });
  expect((await docx.inspectDocumentLinks(input, { scope: "headers" }, textContext)).items).toHaveLength(1);
  await expect(edit(input, "links.set", { scope: "headers", section: 1, link: 1, bookmark: "Next" })).rejects.toMatchObject({ code: "ambiguous-selection" });
});

it("unwraps labels by default and deletes content only with explicit intent, cleaning the last reference", async () => {
  const input = await existing(`<w:p>${link()}${link(run("Other"))}</w:p>`);
  const first = await edit(input, "links.remove", { link: 1 });
  expect(decode(first.archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain(styled);
  expect(first.archive.package.relationships("/word/document.xml")).toHaveLength(1);
  const second = await edit(first.bytes, "links.remove", { link: 1, deleteContent: true });
  expect((await docx.extractDocumentText(second.bytes, textContext)).text).toBe("Coastal guide");
  expect(second.archive.package.relationships("/word/document.xml")).toHaveLength(0);
});

it("creates internal anchors in table cells and switches external links to internal without fetching", async () => {
  const result = await edit(await textFixture(table([paragraph("Cell: ")])), "links.add", { table: 1, cell: "A1", paragraph: 1, text: "Jump", bookmark: "Coast_1" });
  expect((await docx.inspectDocumentLinks(result.bytes, { table: 1, cell: "A1" }, textContext)).items[0]).toMatchObject({ address: "", fragment: "Coast_1", url: "", text: "Jump" });
  const changed = await edit(await existing(`<w:p>${link()}</w:p>`), "links.set", { link: 1, bookmark: "Overview" });
  expect(changed.archive.package.relationships("/word/document.xml")).toHaveLength(0);
  expect((await docx.inspectDocumentLinks(changed.bytes, {}, textContext)).items[0]).toMatchObject({ fragment: "Overview", url: "", text: "Coastal guide" });
});

it.each(["javascript:alert(1)", "data:text/plain,hello", "file:///private/item", "https:coast.invalid", "https:///coast.invalid", " https://coast.invalid", "ht\ntps://coast.invalid", "https://coast.invalid/%zz", "mailto:", "//coast.invalid"])("rejects unsafe or malformed target before input I/O: %s", async target => {
  expect(() => docx.parseDocxArguments(["links", "add", "in.docx", "--paragraph", "1", "--text", "Label", "--target", target, "--dry-run"].map(s => new TextEncoder().encode(s)))).toThrow();
});

it("rejects missing selections and stale tokens without publication", async () => {
  const input = await existing(`<w:p>${link()}${link()}</w:p>`);
  await expect(edit(input, "links.remove", {})).rejects.toMatchObject({ code: "usage" });
  const token = (await docx.inspectDocumentLinks(input, {}, textContext)).items[0]!.location.token;
  const result = await edit(input, "links.set", { link: 1, bookmark: "Overview" });
  await expect(edit(result.bytes, "links.remove", { select: token })).rejects.toMatchObject({ code: "stale-selection" });
});

it("preserves Unicode label targets and percent-encoded whitespace as inert bytes", async () => {
  const target = "https://coast.invalid/café?inset=%C2%A0%E2%80%A8%C2%85#bay";
  const result = await edit(await textFixture(paragraph("Coast")), "links.add", { paragraph: 1, text: "Map", target });
  expect((await docx.inspectDocumentLinks(result.bytes, {}, textContext)).items[0]!.address).toBe(target);
});

it.each(["\u00a0", "\u2028", "\u0085", "\u009f"])("rejects raw Unicode whitespace and controls in targets (%j)", async character => {
  const input = await textFixture(paragraph("Coast"));
  const target = `https://coast.invalid/map${character}inset`;
  await expect(edit(input, "links.add", { paragraph: 1, text: "Map", target }).then(() => "published", error => error.code)).resolves.toBe("usage");
});

it("switches an internal anchor to an external target and clears the old anchor", async () => {
  const input = await textFixture('<w:p><w:hyperlink w:anchor="Overview">' + styled + '</w:hyperlink></w:p>');
  const result = await edit(input, "links.set", { link: 1, target: "http://coast.invalid/#bay" });
  expect((await docx.inspectDocumentLinks(result.bytes, {}, textContext)).items[0]).toMatchObject({ address: "http://coast.invalid/#bay", fragment: "", text: "Coastal guide" });
});

it("retains link-local namespace bindings, run formatting, comments and empty runs when unwrapping", async () => {
  const input = await textFixture(`<w:p><w:hyperlink xmlns:label="${w}" w:anchor="Overview"><!--label boundary--><label:r><label:rPr><label:i/></label:rPr><label:t>Bay</label:t></label:r><label:r/></w:hyperlink></w:p>`);
  const result = await edit(input, "links.remove", { link: 1 });
  expect((await docx.extractDocumentText(result.bytes, textContext)).text).toBe("Bay");
  const root = docx.parseDocumentXml(result.archive.members.find(m => m.name === "word/document.xml")!.bytes).root;
  const runs = root.children[0]!.children[0]!.children;
  expect(runs.map(n => [n.namespace, n.localName])).toEqual([[w, "r"], [w, "r"]]);
  expect(runs[0]!.children[0]!.children[0]!.localName).toBe("i");
  expect(decode(result.archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain("<!--label boundary-->");
});

it("retains inherited XML space and language when removing the wrapper", async () => {
  const input = await textFixture('<w:p><w:hyperlink w:anchor="Overview" xml:space="preserve" xml:lang="pl">' + run(" Coast ") + '<w:r xml:lang="fr"><w:t> baie </w:t></w:r></w:hyperlink></w:p>');
  const result = await edit(input, "links.remove", { link: 1 });
  const runs = docx.parseDocumentXml(result.archive.members.find(m => m.name === "word/document.xml")!.bytes).root.children[0]!.children[0]!.children;
  const xml = "http://www.w3.org/XML/1998/namespace";
  expect(runs.map(n => n.attributes.find(a => a.namespace === xml && a.localName === "space")?.value)).toEqual(["preserve", "preserve"]);
  expect(runs.map(n => n.attributes.find(a => a.namespace === xml && a.localName === "lang")?.value)).toEqual(["pl", "fr"]);
});

it("clears a separate document location even when the stored target is unchanged", async () => {
  const input = await existing('<w:p><w:hyperlink r:id="shared" w:docLocation="OldInset">' + styled + '</w:hyperlink></w:p>');
  const result = await edit(input, "links.set", { link: 1, target: "https://coast.invalid/map?a=1&b=2#bay" });
  expect(result.data.changed).toBe(true);
  expect(decode(result.archive.members.find(m => m.name === "word/document.xml")!.bytes)).not.toContain('w:docLocation');
});

it("preserves a stored address fragment separately from the anchor and reads cached breaks without mutation", async () => {
  const input = await existing('<w:p><w:hyperlink r:id="shared" w:anchor="Inset" w:history="false"><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:lastRenderedPageBreak/><w:t>C</w:t></w:r></w:hyperlink></w:p>');
  const before = new Uint8Array(input);
  const item = (await docx.inspectDocumentLinks(input, {}, textContext)).items[0];
  expect(item).toMatchObject({ address: "https://coast.invalid/map?a=1&b=2#bay", fragment: "Inset", url: "https://coast.invalid/map?a=1&b=2#bay#Inset", text: "A\tB\nC", contains_page_break: true, history: false });
  expect(input).toEqual(before);
});

it("removes all links once, retains unrelated field instructions and never executes stored external targets", async () => {
  const fetch = vi.fn(() => { throw new Error("External execution forbidden"); });
  vi.stubGlobal("fetch", fetch);
  const input = await existing(`<w:p>${link()}${link(run("Second"))}</w:p><w:p><w:fldSimple w:instr="HYPERLINK &quot;file:///never-read&quot;">${run("Cached")}</w:fldSimple></w:p>`);
  const result = await edit(input, "links.remove", { all: true });
  expect(result.data.changes).toHaveLength(2);
  expect((await docx.inspectDocumentLinks(result.bytes, {}, textContext)).items).toEqual([]);
  expect((await docx.extractDocumentText(result.bytes, textContext)).text).toBe("Coastal guideSecond\nCached");
  expect(decode(result.archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain('w:instr="HYPERLINK &quot;file:///never-read&quot;"');
  expect(result.archive.package.relationships("/word/document.xml")).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps relationships referenced in an unselected compatibility branch", async () => {
  const alternative = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:future="urn:future:links"><mc:Choice Requires="future"><w:p>${link(run("Opaque"))}</w:p></mc:Choice><mc:Fallback>${paragraph("Fallback")}</mc:Fallback></mc:AlternateContent>`;
  const input = await existing(`<w:p>${link()}</w:p>${alternative}`);
  const result = await edit(input, "links.remove", { all: true });
  expect(result.archive.package.relationships("/word/document.xml")).toHaveLength(1);
  expect(decode(result.archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain(alternative);
});

it("reports same-target edits as no change and rejects ranges, protected wrappers and exhausted budgets", async () => {
  const input = await existing(`<w:p>${link()}</w:p>`);
  const unchanged = await edit(input, "links.set", { link: 1, target: "https://coast.invalid/map?a=1&b=2#bay" });
  expect(unchanged.data.changed).toBe(false);
  const original = await docx.readDocumentArchive(input, textContext);
  for (const member of original.members) expect(unchanged.archive.members.find(m => m.name === member.name)!.bytes).toEqual(member.bytes);
  const locations = await docx.openDocumentLocations(input, textContext);
  const range = locations.range(locations.at("paragraph", 1).token, 0, 1);
  await expect(edit(input, "links.add", { select: range.token, text: "X", bookmark: "Overview" })).rejects.toMatchObject({ code: "usage" });
  await expect(edit(input, "links.remove", { all: true, limit: [{ name: "matches", value: 0 }] })).rejects.toMatchObject({ code: "limit-exceeded" });
  const controlled = await textFixture('<w:p><w:sdt><w:sdtContent><w:hyperlink w:anchor="Overview">' + run("Controlled") + '</w:hyperlink></w:sdtContent></w:sdt></w:p>');
  await expect(edit(controlled, "links.remove", { link: 1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});
