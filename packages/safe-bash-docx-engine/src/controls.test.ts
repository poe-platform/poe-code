import { expect, it } from "vitest";
import { Volume } from "memfs";
import { textContext, textFixture, run } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { MarkupCompatibility, documentCompatibilityProfile } from "./compatibility.js";
import { parseDocumentXml } from "./package-xml.js";
import { openDocumentLocations } from "./locations.js";
import { getDocumentXml } from "./index.js";
import { extractDocumentText } from "./text.js";

it("admits checkbox attributes only on their exact owners while keeping unknown extensions opaque", () => {
  const root = parseDocumentXml(new TextEncoder().encode('<w:sdtPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="c"><c:checkbox c:val="unknown"><c:checked c:val="1" c:font="unknown"/><c:unknown c:val="1"/></c:checkbox></w:sdtPr>')).root;
  const compatibility = new MarkupCompatibility(root);
  const checkbox = root.children[0]!, checked = checkbox.children[0]!;
  expect(compatibility.canEdit(checkbox)).toBe(true); expect(compatibility.canEdit(checked.attributes[0]!)).toBe(true);
  expect(compatibility.canEdit(checkbox.attributes[0]!)).toBe(false); expect(compatibility.canEdit(checked.attributes[1]!)).toBe(false);
  expect(compatibility.canEdit(checkbox.children[1]!)).toBe(false);
  expect(documentCompatibilityProfile.understoodNamespaces).not.toContain(checkbox.namespace);
});
it("keeps exact default names immutable and rejects foreign/unqualified checkbox attributes", () => {
  const entry = documentCompatibilityProfile.understoodElements![0]!;
  expect(entry.localName).toBe("checkbox");
  const root = parseDocumentXml(new TextEncoder().encode('<w:sdtPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checkbox><c:checked c:val="1" w:unknown="x" mystery="x"/></c:checkbox></w:sdtPr>')).root;
  const checked = root.children[0]!.children[0]!, compatibility = new MarkupCompatibility(root);
  expect(compatibility.canEdit(checked.attributes[0]!)).toBe(true); expect(compatibility.canEdit(checked.attributes[1]!)).toBe(false); expect(compatibility.canEdit(checked.attributes[2]!)).toBe(false);
});
it("freezes exact default admission names and nested arrays", () => {
  const entry = documentCompatibilityProfile.understoodElements![0]!;
  expect(Object.isFrozen(entry)).toBe(true); expect(Object.isFrozen(entry.attributes)).toBe(true);
});
it("indexes nested controls independently and scopes their ordinals", async () => {
  const document = await openDocumentLocations(await textFixture(`<w:p>${control("<w:richText/>", control("<w:text/>"))}</w:p>`), textContext);
  expect(document.list("control").map(item => item.positions.control)).toEqual([1, 2]);
});

export const control = (properties: string, content = run("Old")) => `<w:sdt><w:sdtPr><w:id w:val="7"/><w:tag w:val="bay"/><w:alias w:val="Name"/>${properties}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
it.each(["repeatingSection", "repeatingSectionItem"])("inventories native %s as an explicit non-scalar owner", async name => {
  const module = await import("./controls.js"); const body = `<w:p>${control(`<v:${name} xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"/>`)}</w:p>`;
  expect((await module.inspectDocumentControls(await textFixture(body), {}, textContext)).items[0]).toMatchObject({ kind: name === "repeatingSection" ? "repeating-section" : "repeating-item", value: null });
  await expect(fill(body, { text: "New" }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("lists typed controls through the actual command engine", async () => {
  const input = await textFixture(`<w:p>${control("<w:text/>")}</w:p>`);
  const fs = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["controls", "list", "/input", "--json"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(fs.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(String(fs.readFileSync("/out"))).data.items[0]).toMatchObject({ kind: "plain-text", id: "7", tag: "bay", alias: "Name", value: "Old", lock: "unlocked", placeholder: false });
});
it("escapes human control tags while retaining exact JSON stored values", async () => {
  const input = await textFixture('<w:p><w:sdt><w:sdtPr><w:text/><w:tag w:val="Bay&#13;&#10;&#9;Injected"/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt></w:p>');
  const fs = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["controls", "list", "/input"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(fs.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0); expect(String(fs.readFileSync("/out"))).not.toContain("\r\n\t");
  const module = await import("./controls.js"); expect((await module.inspectDocumentControls(input, {}, textContext)).items[0]!.tag).toBe("Bay\r\n\tInjected");
});

async function fill(body: string, options: Record<string, unknown>) {
  const input = await textFixture(body); const fs = Volume.fromJSON({ "/out": "" });
  const module = await import("./controls.js");
  await module.editDocumentControls(input, { ...(options.all ? {} : { control: 1 }), ...options, output: "-" } as never, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } } });
  const bytes = new Uint8Array(fs.readFileSync("/out") as Buffer);
  return { bytes, items: (await module.inspectDocumentControls(bytes, {}, textContext)).items };
}
it.each(["<w:text/>", "<w:richText/>"])("fills ordinary %s with scalar tabs/breaks and clears only placeholder state", async type => {
  const { items } = await fill(`<w:p>${control(type + '<w:showingPlcHdr/><w:placeholder><w:docPart w:val="Name"/></w:placeholder>', '<w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r>')}</w:p>`, { text: "A\tB\nC" });
  expect(items[0]).toMatchObject({ value: "A\tB\nC", placeholder: false, tag: "bay" });
});
it.each(["dropDownList", "comboBox"])("fills declared %s by distinct value to label", async type => {
  const { items } = await fill(`<w:p>${control(`<w:${type}><w:listItem w:value="a" w:displayText="Harbor"/><w:listItem w:value="b" w:displayText="Coast"/></w:${type}>`)}</w:p>`, { choice: "b" });
  expect(items[0]!.value).toBe("Coast");
});
it("fills Gregorian UTC midnight with stored numeric display", async () => {
  const { items } = await fill(`<w:p>${control('<w:date><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="en-GB"/><w:calendar w:val="gregorian"/></w:date>')}</w:p>`, { date: "2025-02-03" });
  expect(items[0]!.value).toBe("2025-02-03T00:00:00Z");
});
it("uses declared checkbox glyph/font without admitting its namespace", async () => {
  const type = '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>';
  const { items } = await fill(`<w:p>${control(type)}</w:p>`, { checked: true }); expect(items[0]!.value).toBe(true);
});
it.each(['<w:text/><w:lock w:val="sdtLocked"/>', '<w:text/><w:lock w:val="mystery"/>', '<w:text/><w:dataBinding w:xpath="/x" w:storeItemID="abc"/>'])("refuses locked/bound scalar %s", async properties => {
  await expect(fill(`<w:p>${control(properties)}</w:p>`, { text: "New" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it.each(['<w:text/><w:lock w:val="contentLocked"/>', '<w:text/><w:dataBinding w:xpath="/x" w:storeItemID="abc"/>'])("fills independent sibling while preserving %s", async properties => {
  const { bytes } = await fill(`<w:p>${control(properties)}</w:p><w:p>${control("<w:text/>", run("Sibling"))}</w:p>`, { control: 2, text: "New sibling" });
  expect((await extractDocumentText(bytes, textContext)).text).toBe("Old\nNew sibling");
});
it("refuses parent overwrite but fills an unlocked nested leaf", async () => {
  const body = `<w:p>${control("<w:richText/>", control("<w:text/>"))}</w:p>`;
  await expect(fill(body, { text: "New", all: true })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect((await fill(body, { text: "New", control: 2 })).items[1]!.value).toBe("New");
});
it("fills empty paragraph content while preserving paragraph/run properties and placeholder definition", async () => {
  const { bytes, items } = await fill(control('<w:text/><w:showingPlcHdr/><w:placeholder><w:docPart w:val="Name"/></w:placeholder>', '<w:p xml:lang="ar"><w:pPr><w:bidi/></w:pPr><w:r xml:space="preserve"><w:rPr><w:i/></w:rPr><w:t>Old</w:t></w:r></w:p>'), { text: "" });
  expect(items[0]!.value).toBe(""); const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  expect(xml).toContain('xml:lang="ar"'); expect(xml).toContain('xml:space="preserve"'); expect(xml).toContain("<w:bidi/>"); expect(xml).toContain("<w:i/>"); expect(xml).toContain("<w:placeholder>"); expect(xml).not.toContain("showingPlcHdr");
});
it.each(["sdtLocked", "contentLocked", "unknown"])("refuses nested leaves under ancestor lock %s", async lock => {
  await expect(fill(`<w:p>${control(`<w:richText/><w:lock w:val="${lock}"/>`, control("<w:text/>"))}</w:p>`, { text: "New", control: 2 })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("refuses a control inside an ordinary complex field cached span", async () => {
  await expect(fill(`<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${control("<w:text/>")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`, { text: "New" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("preserves unrelated opaque properties while filling admitted scalar content", async () => {
  const { bytes } = await fill(`<w:p>${control('<w:text/><u:metadata xmlns:u="urn:owned-opaque" value="keep"/>')}</w:p>`, { text: "New" });
  expect((await extractDocumentText(bytes, textContext)).text).toBe("New");
  expect(new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array)).toContain('<u:metadata xmlns:u="urn:owned-opaque" value="keep"/>');
});
it.each(['<c:unknown/>', '<c:checkedState c:val="2612" c:font="Symbol" c:unknown="x"/>'])("refuses unknown affected checkbox metadata %s", async extra => {
  const type = `<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/>${extra}</c:checkbox>`;
  await expect(fill(`<w:p>${control(type)}</w:p>`, { checked: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("refuses malformed unused checkbox glyph mapping", async () => {
  const type = '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="D800" c:font="Symbol"/></c:checkbox>';
  await expect(fill(`<w:p>${control(type)}</w:p>`, { checked: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("keeps unsupported control types inventoried and refuses their fill", async () => {
  const module = await import("./controls.js"); const body = `<w:p>${control('<w:docPartObj><w:docPartGallery w:val="Page Numbers"/></w:docPartObj>')}</w:p>`;
  const items = (await module.inspectDocumentControls(await textFixture(body), {}, textContext)).items;
  expect(items[0]).toMatchObject({ kind: "unsupported", support: "unsupported" });
  await expect(fill(body, { text: "New" }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("inventories malformed repeated scalar metadata beside ordinary controls", async () => {
  const module = await import("./controls.js"); const body = `<w:p>${control('<w:text/><w:tag w:val="second"/>')}${control("<w:text/>")}</w:p>`;
  const items = (await module.inspectDocumentControls(await textFixture(body), {}, textContext)).items;
  expect(items).toHaveLength(2); expect(items[0]!.support).toBe("unsupported"); expect(items[1]!.support).toBe("supported");
});
it("retains inherited XML semantics when the first affected run moves from a later paragraph", async () => {
  const { bytes } = await fill(control('<w:richText/>', `<w:p/><w:p xml:lang="ar">${run("Bay")}</w:p>`), { text: "Shore" });
  const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  expect(xml).toContain('xml:lang="ar"');
});
it("lists compatibility-selected cached control text without inactive choices", async () => {
  const content = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><mc:Choice Requires="c"><w:r><w:t>Hidden</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>Visible</w:t></w:r></mc:Fallback></mc:AlternateContent>';
  const module = await import("./controls.js"); const input = await textFixture(`<w:p>${control("<w:richText/>", content)}</w:p>`);
  expect((await module.inspectDocumentControls(input, {}, textContext)).items[0]!.value).toBe("Visible");
  await expect(fill(`<w:p>${control("<w:richText/>", content)}</w:p>`, { text: "New" }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("refuses nested leaf filling beneath an unsupported ancestor type", async () => {
  await expect(fill(`<w:p>${control('<w:docPartObj/>', control("<w:text/>"))}</w:p>`, { text: "New", control: 2 }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("scopes control positions within selected paragraphs and accepts stable control tokens", async () => {
  const module = await import("./controls.js"); const input = await textFixture(`<w:p>${control("<w:text/>", run("First"))}</w:p><w:p>${control("<w:text/>", run("Second"))}</w:p>`);
  const scoped = await module.inspectDocumentControls(input, { paragraph: 2, control: 1 }, textContext); expect(scoped.items[0]!.value).toBe("Second");
  expect((await module.inspectDocumentControls(input, { select: scoped.items[0]!.location.token }, textContext)).items[0]!.value).toBe("Second");
  const changed = await textFixture(`<w:p>${control("<w:text/>", run("Changed"))}</w:p>`);
  await expect(module.inspectDocumentControls(changed, { select: scoped.items[0]!.location.token }, textContext)).rejects.toMatchObject({ code: "stale-selection" });
});
it("enforces explicit all cardinality and preflights mixed kinds before publication", async () => {
  const body = `<w:p>${control("<w:text/>")}${control("<w:text/>")}</w:p>`;
  const module = await import("./controls.js"); const input = await textFixture(body);
  const owner = (await openDocumentLocations(input, textContext)).list("paragraph")[0]!;
  await expect(module.editDocumentControls(input, { select: owner.token, text: "New", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "ambiguous-selection" });
  expect((await fill(body, { all: true, text: "New" })).items.map(item => item.value)).toEqual(["New", "New"]);
  await expect(fill(`<w:p>${control("<w:text/>")}${control("<w:date/>")}</w:p>`, { all: true, text: "New" }).then(() => undefined)).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("supports dry run without sink publication and rejects cancellation and exact output-budget overflow", async () => {
  const module = await import("./controls.js"); const input = await textFixture(`<w:p>${control("<w:text/>")}</w:p>`); const { DocumentBudget } = await import("./budget.js"); let writes = 0;
  const args = { control: 1, text: "New", dryRun: true } as const; const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write() { writes++; } } };
  expect(await module.editDocumentControls(input, args, context)).toMatchObject({ changed: true, dryRun: true, output: null }); expect(writes).toBe(0);
  const controller = new AbortController(); controller.abort("stop"); await expect(module.editDocumentControls(input, args, { ...context, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  await expect(module.editDocumentControls(input, args, { ...context, budget: new DocumentBudget({ serializedOutput: 100 }, textContext.signal) })).rejects.toMatchObject({ code: "limit-exceeded" }); expect(writes).toBe(0);
});
it("preserves checkbox first-run bold formatting while updating its declared font", async () => {
  const properties = '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>';
  const { bytes } = await fill(`<w:p>${control(properties, '<w:r><w:rPr><w:b/><w:rFonts w:ascii="Old" w:hAnsi="Old"/></w:rPr><w:t>Old</w:t></w:r>')}</w:p>`, { checked: true });
  const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array); expect(xml).toContain("<w:b/>"); expect(xml).toContain('w:ascii="Symbol"');
});
