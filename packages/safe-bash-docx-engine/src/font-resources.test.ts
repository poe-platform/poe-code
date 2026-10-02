import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const encode = (value: string) => new TextEncoder().encode(value);
const theme = `<a:theme xmlns:a="${a}" xmlns:x="urn:coast:extension" name="Coast"><a:themeElements><a:clrScheme name="Coast"><a:dk1><a:sysClr val="windowText" lastClr="182838"/></a:dk1><a:accent1><a:srgbClr val="246880"/></a:accent1></a:clrScheme><a:fontScheme name="Coast"><a:majorFont><a:latin typeface="Coast Serif"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="海 Serif"/><a:font script="Arab" typeface="ساحل"/></a:majorFont><a:minorFont><a:latin typeface="Coast Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Coast"/></a:themeElements><a:extLst><x:kept x:flag="1"/></a:extLst></a:theme>`;
const fonts = `<w:fonts xmlns:w="${w}" xmlns:r="${r}"><w:font w:name="Coast Serif"><w:altName w:val="Coast Alternate"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/><w:embedRegular r:id="fontData" w:fontKey="{12345678-1234-1234-1234-123456789ABC}" w:subsetted="1"/></w:font></w:fonts>`;

async function fixture(options: { strict?: boolean; missing?: boolean; invalid?: boolean } = {}) {
  const source = await textFixture('<w:p><w:pPr><w:pStyle w:val="Detail"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Fallback" w:asciiTheme="majorAscii" w:eastAsiaTheme="majorEastAsia" w:cstheme="majorBidi"/><w:color w:val="246880" w:themeColor="accent1" w:themeTint="80"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr><w:t>Coastal survey 海</w:t></w:r></w:p>', {
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:hAnsiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:color w:val="246880" w:themeColor="accent1"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Detail"><w:name w:val="Detail"/><w:basedOn w:val="Base"/></w:style></w:styles>` },
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:themeFontLang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:settings>` }
  });
  const archive = await docx.readArchive(source, textContext);
  const volume = Volume.fromJSON({ "/out": "" });
  const members = [...archive.members];
  const add = (name: string, bytes: Uint8Array) => members.push({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  const types = new docx.DocumentXmlEditor(members.find(m => m.name === "[Content_Types].xml")!.bytes);
  types.insertChildren(types.root, `<Override xmlns="${types.root.namespace}" PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Default xmlns="${types.root.namespace}" Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>${options.missing ? "" : `<Override xmlns="${types.root.namespace}" PartName="/word/theme/palette.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`}`);
  const typesIndex = members.findIndex(m => m.name === "[Content_Types].xml");
  members[typesIndex] = { ...members[typesIndex]!, bytes: types.serialize() };
  const rel = new docx.DocumentXmlEditor(members.find(m => m.name === "word/_rels/document.xml.rels")!.bytes);
  rel.insertChildren(rel.root, `<Relationship xmlns="${rel.root.namespace}" Id="fontTable" Type="${r}/fontTable" Target="fontTable.xml"/>${options.missing ? "" : `<Relationship xmlns="${rel.root.namespace}" Id="palette" Type="${r}/theme" Target="theme/palette.xml"/>`}`);
  const relIndex = members.findIndex(m => m.name === "word/_rels/document.xml.rels");
  members[relIndex] = { ...members[relIndex]!, bytes: rel.serialize() };
  add("word/fontTable.xml", encode(options.invalid ? fonts.replace('r:id="fontData"', 'r:id="absent"') : fonts));
  add("word/_rels/fontTable.xml.rels", encode(`<Relationships xmlns="${rel.root.namespace}"><Relationship Id="fontData" Type="${r}/font" Target="fonts/coast.odttf"/></Relationships>`));
  add("word/fonts/coast.odttf", new Uint8Array([7, 31, 67, 127, 191, 251]));
  if (!options.missing) add("word/theme/palette.xml", encode(theme));
  const dialect = docx.documentDialects.strict;
  await docx.writeArchive({ ...archive, members: members.map(m => m.name.endsWith(".xml") || m.name.endsWith(".rels") ? { ...m, bytes: encode(new TextDecoder().decode(m.bytes).split(w).join(options.strict ? dialect.w : w).split(r).join(options.strict ? dialect.r : r).split(a).join(options.strict ? dialect.a : a)) } : m) }, { async write(b) { volume.appendFileSync("/out", b); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}

async function altered(input: Uint8Array, part: string, transform: (editor: docx.DocumentXmlEditor) => void) {
  const archive = await docx.readArchive(input, textContext);
  const member = archive.members.find(m => m.name === part)!;
  const editor = new docx.DocumentXmlEditor(member.bytes);
  transform(editor);
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.writeArchive({ ...archive, members: archive.members.map(m => m === member ? { ...m, bytes: editor.serialize() } : m) }, { async write(b) { volume.appendFileSync("/out", b); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}

it.each([false, true])("inventories theme schemes, language mappings and inert font metadata in dialect %s", async strict => {
  const bytes = await fixture({ strict });
  const before = bytes.slice();
  const inventory = (await docx.inspectDocument(bytes, textContext)).fontResources;
  expect(inventory).toMatchObject({ availability: null, licensing: null, embeddedFontMutation: "unsupported", diagnostics: [],
    themes: [{ part: "/word/theme/palette.xml", name: "Coast", colors: [
      { slot: "dk1", kind: "sysClr", value: "windowText", lastColor: "182838" },
      { slot: "accent1", kind: "srgbClr", value: "246880", lastColor: null }
    ], fonts: expect.arrayContaining([{ family: "major", slot: "latin", script: null, typeface: "Coast Serif" }, { family: "major", slot: "font", script: "Jpan", typeface: "海 Serif" }]) }],
    fontTables: [{ part: "/word/fontTable.xml", fonts: [{ name: "Coast Serif", alternateName: "Coast Alternate", charset: "00", family: "roman", pitch: "variable", embedded: [{ kind: "embedRegular", id: "fontData", fontKey: "{12345678-1234-1234-1234-123456789ABC}", subsetted: "1", target: "/word/fonts/coast.odttf", status: "resolved" }] }] }],
    languages: [{ part: "/word/settings.xml", values: { val: "en-US", eastAsia: "ja-JP", bidi: "ar-SA" } }]
  });
  expect(inventory.references).toEqual(expect.arrayContaining([expect.objectContaining({ part: "/word/styles.xml", attribute: "hAnsiTheme", value: "minorHAnsi", status: "resolved" }), expect.objectContaining({ attribute: "cstheme", value: "majorBidi", status: "resolved" })]));
  expect(bytes).toEqual(before);
});

it("reports missing themes and dangling font IDs without guessing fonts or fetching resources", async () => {
  const inventory = (await docx.inspectDocument(await fixture({ missing: true, invalid: true }), textContext)).fontResources;
  expect(inventory.themes).toEqual([]);
  expect(inventory.references.every(ref => ref.status === "missing-theme")).toBe(true);
  expect(inventory.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-theme" }), expect.objectContaining({ code: "invalid-font-reference" })]));
  expect(inventory.fontTables[0]!.fonts[0]!.embedded[0]).toMatchObject({ target: null, status: "invalid-font-reference" });
});

it("preserves font bytes, theme extensions and multilingual references through typed edits and text replacement", async () => {
  const input = await fixture();
  const volume = Volume.fromJSON({ "/out": "" });
  const sink = { async write(b: Uint8Array) { volume.appendFileSync("/out", b); } };
  await docx.formatDocumentRuns(input, { paragraph: 1, run: 1, asciiTheme: "minorAscii", themeColor: { enum: "MSO_THEME_COLOR", name: "DARK_1" }, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  const formatted = new Uint8Array(volume.readFileSync("/out") as Buffer);
  volume.writeFileSync("/out", "");
  await docx.replaceDocumentText(formatted, { find: "survey", with: "record", all: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const original = await docx.readArchive(input, textContext), edited = await docx.readArchive(output, textContext);
  for (const member of original.members.filter(m => m.name !== "word/document.xml")) expect(edited.members.find(m => m.name === member.name)!.bytes, member.name).toEqual(member.bytes);
  const xml = new TextDecoder().decode(edited.members.find(m => m.name === "word/document.xml")!.bytes);
  for (const text of ['w:asciiTheme="minorAscii"', 'w:eastAsiaTheme="majorEastAsia"', 'w:cstheme="majorBidi"', 'w:bidi="ar-SA"', 'w:eastAsia="ja-JP"', 'w:themeTint="80"']) expect(xml).toContain(text);
  expect((await docx.inspectDocument(output, textContext)).fontResources.diagnostics).toEqual([]);
  const styles = await docx.inspectDocumentStyles(output, { name: "Detail" }, textContext);
  expect(styles.styles[0]).toMatchObject({ direct: { themeColor: null }, effective: { themeColor: "accent1" } });
});

it("rejects embedded font metadata mutation before publication", async () => {
  const input = await fixture();
  const volume = Volume.fromJSON({ "/out": "untouched" });
  await expect(docx.replaceDocumentXmlPart(input, encode(fonts.replace('w:subsetted="1"', 'w:subsetted="0"')), { part: "/word/fontTable.xml", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(b) { volume.appendFileSync("/out", b); } } })).rejects.toThrow("Embedded font mutation is unsupported");
  expect(volume.readFileSync("/out", "utf8")).toBe("untouched");
});

it("exposes the same resource inventory through CLI JSON and its closed schema", async () => {
  const input = await fixture();
  let output = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["inspect", "-", "--json"].map(encode), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { throw new Error("Unexpected file read"); } }, stdin: { async *[Symbol.asyncIterator]() { yield input; } },
    stdout: { async write(b) { output += new TextDecoder().decode(b); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).data.fontResources).toEqual((await docx.inspectDocument(input, textContext)).fontResources);
  const discovery = docx.getDocxDiscovery(docx.parseDocxArguments(["schema", "inspect"].map(encode)))!.data as docx.DocxSchemaData;
  expect(discovery.operations[0]!.result.oneOf![0]!.properties!.data!.properties!.fontResources).toMatchObject({ type: "object", additionalProperties: false, properties: { themes: { type: "array" }, references: { type: "array" }, availability: { type: "null" }, licensing: { type: "null" } } });
  const capabilities = docx.getDocxDiscovery(docx.parseDocxArguments(["capabilities"].map(encode)))!.data as docx.DocxCapabilitiesData;
  expect(capabilities.features).toContainEqual(expect.objectContaining({ id: "F42", level: "read" }));
});

it("validates theme tokens before any input read", async () => {
  for (const flag of [["--ascii-theme", "unknown"], ["--theme-color", "NOT_THEME_COLOR"]]) {
    let reads = 0;
    const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["runs", "set", "input.docx", "--paragraph", "1", "--run", "1", ...flag, "--dry-run"].map(encode), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile() { reads++; return new Uint8Array(); } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(2);
    expect(reads).toBe(0);
  }
});

it("distinguishes invalid reference names and missing slots from missing themes", async () => {
  const input = await altered(await fixture(), "word/document.xml", editor => {
    const run = editor.root.children[0]!.children[0]!.children[1]!;
    const props = run.children[0]!;
    editor.setAttribute(props.children[0]!, { namespace: w, localName: "asciiTheme" }, "majorconstructor");
    editor.setAttribute(props.children[1]!, { namespace: w, localName: "themeColor" }, "accent6");
  });
  const inventory = (await docx.inspectDocument(input, textContext)).fontResources;
  expect(inventory.references).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: "majorconstructor", status: "invalid-theme-reference" }),
    expect.objectContaining({ value: "accent6", status: "missing-theme-slot" })
  ]));
});

it("does not use orphaned or external themes to satisfy package references", async () => {
  const input = await fixture();
  for (const external of [false, true]) {
    const modified = await altered(input, "word/_rels/document.xml.rels", editor => {
      const edge = editor.root.children.find(n => n.attributes.some(a => a.localName === "Id" && a.value === "palette"))!;
      if (external) {
        editor.replaceElement(edge, `<Relationship xmlns="${editor.root.namespace}" Id="palette" Type="${r}/theme" Target="https://fonts.invalid/theme.xml" TargetMode="External"/>`);
      } else editor.replaceElement(edge, "");
    });
    const resources = (await docx.inspectDocument(modified, textContext)).fontResources;
    expect(resources.themes).toHaveLength(1);
    expect(resources.references.every(ref => ref.status === "missing-theme")).toBe(true);
  }
});

it("reports an unsupported embedding change clearly through the CLI", async () => {
  const input = await fixture();
  const volume = Volume.fromJSON({ "/replacement.xml": fonts.replace('w:subsetted="1"', 'w:subsetted="0"') });
  let output = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["xml", "set", "-", "--part", "/word/fontTable.xml", "--file", "replacement.xml", "--dry-run", "--json"].map(encode), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() { yield input; } },
    stdout: { async write(b) { output += new TextDecoder().decode(b); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(output)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "unsupported-edit", message: expect.stringContaining("Embedded font mutation is unsupported") }] });
});

it("retains inherited theme absence in live formatting views and preserves resources on save", async () => {
  const input = await fixture();
  const model = await docx.openDocumentStyleModel(input, textContext);
  const detail = model.styles.at("Detail") as docx.ParagraphStyle;
  expect(detail.font.color.theme_color).toBe(null);
  expect((detail.base_style as docx.ParagraphStyle).font.color.theme_color).toEqual(docx.MSO_THEME_COLOR.ACCENT_1);
  detail.font.color.theme_color = docx.MSO_THEME_COLOR.DARK_1;
  expect(detail.font.color.type).toEqual(docx.MSO_COLOR_TYPE.THEME);
  detail.font.color.theme_color = null;
  expect(detail.font.color.theme_color).toBe(null);
  const volume = Volume.fromJSON({ "/out": "" });
  await model.save({ async write(b) { volume.appendFileSync("/out", b); } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const before = await docx.readArchive(input, textContext), after = await docx.readArchive(output, textContext);
  for (const part of before.members.filter(m => m.name !== "word/styles.xml")) expect(after.members.find(m => m.name === part.name)!.bytes).toEqual(part.bytes);
  expect((await docx.inspectDocumentStyles(output, { name: "Detail" }, textContext)).styles[0]!.effective!.themeColor).toBe("accent1");
});

it("rejects rebinding embedded font relationships but allows unchanged font-table XML", async () => {
  const input = await fixture();
  const source = await docx.getDocumentXml(input, textContext, { part: "/word/_rels/fontTable.xml.rels", raw: true }) as Uint8Array;
  const editor = new docx.DocumentXmlEditor(source);
  editor.setAttribute(editor.root.children[0]!, "Target", "theme/palette.xml");
  await expect(docx.replaceDocumentXmlPart(input, editor.serialize(), { part: "/word/_rels/fontTable.xml.rels", dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toThrow("Embedded font mutation is unsupported");
  expect(await docx.replaceDocumentXmlPart(input, encode(fonts), { part: "/word/fontTable.xml", dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).toMatchObject({ changed: false, output: null });
});

it("uses the document text-color mapping when checking theme slots", async () => {
  let input = await altered(await fixture(), "word/settings.xml", editor => {
    editor.insertChildren(editor.root, `<w:clrSchemeMapping xmlns:w="${w}" w:t1="accent6"/>`);
  });
  input = await altered(input, "word/document.xml", editor => {
    editor.setAttribute(editor.root.children[0]!.children[0]!.children[1]!.children[0]!.children[1]!, { namespace: w, localName: "themeColor" }, "text1");
  });
  const resources = (await docx.inspectDocument(input, textContext)).fontResources;
  expect(resources.colorMappings).toEqual([{ part: "/word/settings.xml", values: { t1: "accent6" } }]);
  expect(resources.references).toContainEqual(expect.objectContaining({ value: "text1", status: "missing-theme-slot" }));
});

it("rejects a relationship to missing font bytes during package admission", async () => {
  const input = await altered(await fixture(), "word/_rels/fontTable.xml.rels", editor => {
    editor.setAttribute(editor.root.children[0]!, "Target", "fonts/absent.odttf");
  });
  await expect(docx.inspectDocument(input, textContext)).rejects.toBeInstanceOf(docx.InvalidPackageError);
});

it("honors case-insensitive content types when resolving and protecting fonts", async () => {
  const input = await altered(await fixture(), "[Content_Types].xml", editor => {
    for (const node of editor.root.children) {
      const type = node.attributes.find(a => a.localName === "ContentType")!.value;
      if (type.includes("font") || type.includes("Font") || type.endsWith(".theme+xml")) editor.setAttribute(node, "ContentType", type.toUpperCase());
    }
  });
  expect((await docx.inspectDocument(input, textContext)).fontResources.diagnostics).toEqual([]);
  await expect(docx.replaceDocumentXmlPart(input, encode(fonts.replace('w:subsetted="1"', 'w:subsetted="0"')), { part: "/word/fontTable.xml", dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toThrow("Embedded font mutation is unsupported");
});
