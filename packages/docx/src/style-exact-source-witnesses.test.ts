import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

type Child = {tag: string; attrs: Record<string, string>};
type Style = {attrs: Record<string, string>; children: readonly Child[]};
type Case = {row: number; member: string; styles: readonly Style[]; index?: number; value?: unknown; expected?: unknown; after?: Style; deleted?: boolean};
const style = (attrs: Record<string, string> = {}, children: readonly Child[] = []): Style => ({attrs, children});
const child = (tag: string, val?: string): Child => ({tag, attrs: val === undefined ? {} : {val}});
// Independently authored native records; no source catalog is read by this suite.
const cases: Case[] = [
  ...(["paragraph", "character", "table", "numbering"] as const).map((type, i) => ({row: 647 + i, member: "factory", styles: [style({type})], expected: ["ParagraphStyle", "CharacterStyle", "TableStyle", "BaseStyle"][i]})),
  {row: 651, member: "style_id", styles: [style()], expected: null},
  {row: 652, member: "style_id", styles: [style({styleId: "Foobar"})], expected: "Foobar"},
  {row: 653, member: "style_id", styles: [style()], value: "Foo", after: style({styleId: "Foo"})},
  {row: 654, member: "style_id", styles: [style({styleId: "Foo"})], value: "Bar", after: style({styleId: "Bar"})},
  {row: 655, member: "style_id", styles: [style({styleId: "Bar"})], value: null, after: style()},
  {row: 656, member: "style_id", styles: [style()], value: null, after: style()},
  ...([undefined, "paragraph", "character", "numbering"] as const).map((type, i) => ({row: 657 + i, member: "type", styles: [style(type === undefined ? {} : {type})], expected: {enum: "WD_STYLE_TYPE", name: ["PARAGRAPH", "PARAGRAPH", "CHARACTER", "LIST"][i]}})),
  {row: 661, member: "name", styles: [style({type: "table"})], expected: null},
  {row: 662, member: "name", styles: [style({type: "table"}, [child("name", "Boofar")])], expected: "Boofar"},
  {row: 663, member: "name", styles: [style({type: "table"}, [child("name", "heading 1")])], expected: "Heading 1"},
  {row: 664, member: "name", styles: [style()], value: "Foo", after: style({}, [child("name", "Foo")])},
  {row: 665, member: "name", styles: [style({}, [child("name", "Foo")])], value: "Bar", after: style({}, [child("name", "Bar")])},
  {row: 666, member: "name", styles: [style({}, [child("name", "Bar")])], value: null, after: style()},
  ...([undefined, "0", "1"] as const).map((customStyle, i) => ({row: 667 + i, member: "builtin", styles: [style(customStyle === undefined ? {} : {customStyle})], expected: i !== 2})),
];
function flags(firstGet: number, firstSet: number, member: string, tag: string, getValues: readonly (string | undefined | null)[], changes: readonly [string | undefined | null, boolean][]) {
  getValues.forEach((value, i) => cases.push({row: firstGet + i, member, styles: [style({}, value === null ? [] : [child(tag, value)])], expected: value !== null && value !== "0"}));
  changes.forEach(([before, value], i) => cases.push({row: firstSet + i, member, styles: [style({}, before === null ? [] : [child(tag, before)])], value, after: style({}, value ? [child(tag, "1")] : [])}));
}
flags(670, 674, "hidden", "semiHidden", [null, undefined, "0", "1"], [[null, true], ["0", true], ["1", true], [null, false], [undefined, false], ["1", false]]);
cases.push(
  {row: 680, member: "priority", styles: [style()], expected: null},
  {row: 681, member: "priority", styles: [style({}, [child("uiPriority", "42")])], expected: 42},
  {row: 682, member: "priority", styles: [style()], value: 42, after: style({}, [child("uiPriority", "42")])},
  {row: 683, member: "priority", styles: [style({}, [child("uiPriority", "42")])], value: 24, after: style({}, [child("uiPriority", "24")])},
  {row: 684, member: "priority", styles: [style({}, [child("uiPriority", "24")])], value: null, after: style()}
);
flags(685, 689, "unhide_when_used", "unhideWhenUsed", [null, undefined, "0", "1"], [[null, true], [undefined, false], ["0", true], ["1", true], ["1", false], [null, false]]);
flags(695, 699, "quick_style", "qFormat", [null, undefined, "0", "on"], [[null, true], [undefined, false], [undefined, true], ["0", false], ["on", true]]);
flags(704, 708, "locked", "locked", [null, undefined, "0", "1"], [[null, true], ["0", true], ["1", true], [null, false], [undefined, false], ["1", false]]);
cases.push(
  {row: 714, member: "delete", styles: [style()], deleted: true},
  {row: 715, member: "base_style", styles: [style({styleId: "Foo"}), style({}, [child("basedOn", "Foo")])], index: 1, expected: 0},
  {row: 716, member: "base_style", styles: [style({styleId: "Foo"}), style({}, [child("basedOn", "Bar")])], index: 1, expected: null},
  {row: 717, member: "base_style", styles: [style()], expected: null},
  {row: 718, member: "base_style", styles: [style(), style({styleId: "Foo"})], value: 1, after: style({}, [child("basedOn", "Foo")])},
  {row: 719, member: "base_style", styles: [style({}, [child("basedOn", "Foo")]), style({styleId: "Foo"}), style({styleId: "Bar"})], value: 2, after: style({}, [child("basedOn", "Bar")])},
  {row: 720, member: "base_style", styles: [style({}, [child("basedOn", "Bar")]), style({styleId: "Bar"})], value: null, after: style()},
  {row: 721, member: "font", styles: [style()], expected: "Font"},
  ...(["H1", "H2", "Body", "Foo"] as const).map((_, i) => ({row: 722 + i, member: "next_paragraph_style", styles: [style({type: "paragraph", styleId: "H1"}, [child("next", "Body")]), style({type: "paragraph", styleId: "H2"}, [child("next", "Char")]), style({type: "paragraph", styleId: "Body"}), style({type: "paragraph", styleId: "Foo"}, [child("next", "Bar")]), style({type: "character", styleId: "Char"})], index: i, expected: i === 0 ? 2 : i})),
  {row: 726, member: "next_paragraph_style", styles: [style({type: "paragraph", styleId: "H"}), style({type: "paragraph", styleId: "B"})], value: 1, after: style({type: "paragraph", styleId: "H"}, [child("next", "B")])},
  {row: 727, member: "next_paragraph_style", styles: [style({type: "paragraph", styleId: "H"}), style({type: "paragraph", styleId: "B"})], value: null, after: style({type: "paragraph", styleId: "H"})},
  {row: 728, member: "next_paragraph_style", styles: [style({type: "paragraph", styleId: "H"}), style({type: "paragraph", styleId: "B"})], value: 0, after: style({type: "paragraph", styleId: "H"})},
  {row: 729, member: "paragraph_format", styles: [style()], expected: "ParagraphFormat"}
);
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
const typeFor = (c: Case) => c.member === "base_style" || c.member === "font" ? "CharacterStyle" : c.member === "next_paragraph_style" || c.member === "paragraph_format" ? "ParagraphStyle" : "BaseStyle";
const xmlStyle = (s: Style) => `<w:style${Object.entries(s.attrs).map(([key, value]) => ` w:${key}="${value}"`).join("")}>${s.children.map(c => `<w:${c.tag}${Object.entries(c.attrs).map(([key, value]) => ` w:${key}="${value}"`).join("")}/>`).join("")}</w:style>`;
expect(cases.map(c => c.row).sort((a, b) => a - b)).toEqual(Array.from({length: 83}, (_, i) => 647 + i));
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const c of cases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact style source witness S${c.row}; strict=${strict}; kind=${kind}`, async () => {
  const input0 = await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}">${c.styles.map(xmlStyle).join("")}<!--retain--><?audit keep?></w:styles>`}}, strict), parts = readPackage(input0), memory = Volume.fromJSON({"/input": "", "/out": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, edits = Object.hasOwn(c, "value") || c.deleted, invalidNextFixture = c.row >= 722 && c.row <= 725, ownerMember = ["base_style", "next_paragraph_style"].includes(c.member), operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.__iter__.call", receiver: ref("styles"), arguments: {}, resultHandle: "items"},
    {operation: `model.styles.style.${typeFor(c)}.${c.member === "factory" ? "type.get" : c.deleted ? "delete.call" : c.member + (edits ? ".set" : ".get")}`, receiver: ref("items", c.index ?? 0), arguments: edits && !c.deleted ? {value: ownerMember && c.value !== null ? ref("items", c.value as number) : c.value} : {}, ...(!edits ? {resultHandle: "observed"} : {})}
  ];
  if (invalidNextFixture) {
    const report = api.validateDocumentArchive(await api.readArchive(input, textContext));
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map(d => d.code)).toEqual(["style-next-type"]);
  }
  if (!edits && ownerMember && c.expected !== null) operations.push({operation: "model.styles.style.BaseStyle.__eq__.call", receiver: ref("observed"), arguments: {other: ref("items", c.expected as number)}});
  if (!edits && ["font", "paragraph_format"].includes(c.member)) {
    operations.push({operation: `model.styles.style.${typeFor(c)}.${c.member}.get`, receiver: ref("items", c.index ?? 0), arguments: {}, resultHandle: "same"});
    operations.push({operation: `model.text.${c.member === "font" ? "run.Font" : "parfmt.ParagraphFormat"}.__eq__.call`, receiver: ref("observed"), arguments: {other: ref("same")}});
  }
  const observe = (values: unknown[]) => {
    if (ownerMember) expect(values.at(-1)).toEqual(c.expected === null ? null : true);
    else if (c.member === "factory") expect(values[1] && (values[1] as {type: string}[])[c.index ?? 0]!.type).toBe(c.expected === "TableStyle" ? "_TableStyle" : c.expected);
    else if (["font", "paragraph_format"].includes(c.member)) {expect((values[2] as {type: string}).type).toBe(c.expected); expect(values.at(-1)).toBe(true);}
    else expect(values.at(-1)).toEqual(c.expected);
  };
  if (route === "model") {
    const doc = await api.Document(input, textContext), items = [...doc.styles], selected = items[c.index ?? 0]!;
    if (c.deleted) {selected.delete(); expect(() => selected.name).toThrow(api.StaleHandleError); expect(() => selected.element).toThrow(api.StaleHandleError);}
    else if (edits) Reflect.set(selected, c.member, ownerMember && c.value !== null ? items[c.value as number] : c.value);
    else if (c.member === "factory") expect(selected.constructor.name).toBe(c.expected);
    else {const value: unknown = Reflect.get(selected, c.member); if (ownerMember) expect(value === null ? null : (value as api.BaseStyle).equals(items[c.expected as number])).toBe(c.expected === null ? null : true); else if (["font", "paragraph_format"].includes(c.member)) {expect((value as api.Font | api.ParagraphFormat).constructor.name).toBe(c.expected); expect((value as api.Font).equals(Reflect.get(selected, c.member))).toBe(true); expect((value as api.Font).part).toBe(selected.part);} else expect(value).toEqual(c.expected);}
    if (invalidNextFixture) {expect(doc.styles.part.blob).toEqual(parts.get("word/styles.xml")); await expect(doc.save(sink)).rejects.toMatchObject({code: "invalid-package", diagnostics: expect.arrayContaining([expect.objectContaining({code: "style-next-type"})])}); expect(memory.readFileSync("/out")).toHaveLength(0);}
    else await doc.save(sink);
  } else if (route === "sdk") {const result = await api.applyStyleModelBatch(input, {version: 1, operations}, textContext); if (!edits) observe(result.results.map(r => r.value)); if (invalidNextFixture) {expect(result.changes).toEqual([]); await expect(result.save(sink)).rejects.toMatchObject({code: "invalid-package", diagnostics: expect.arrayContaining([expect.objectContaining({code: "style-next-type"})])}); expect(memory.readFileSync("/out")).toHaveLength(0);} else await result.save(sink);}
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
    try {
      const readOperations = invalidNextFixture ? [
        {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
        {operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("part"), arguments: {reltype: `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}/styles`}, resultHandle: "stylesPart"},
        {operation: "model.parts.styles.StylesPart.styles.get", receiver: ref("stylesPart"), arguments: {}, resultHandle: "styles"},
        operations[1]!, ...operations.slice(2)
      ] : operations;
      const command = `docx batch /input --ops-json '${JSON.stringify({version: 1, operations: readOperations})}' --json${invalidNextFixture ? "" : " --output /out"}`;
      const r = await shell.exec(command); expect(r.exitCode, r.stdout + r.stderr).toBe(0);
      if (!edits) observe(JSON.parse(r.stdout).data.results.map((r: {data: unknown}) => r.data));
      if (invalidNextFixture) {
        await expect(fs.readFile("/out")).rejects.toBeDefined();
        await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
        const creating = `docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --json --output /out --force`;
        for (const suffix of ["", " --dry-run"]) {const reject = await shell.exec(creating + suffix); expect(reject.exitCode, reject.stdout + reject.stderr).toBe(1); expect(JSON.parse(reject.stdout).errors[0].code).toBe("invalid-package"); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");}
      } else memory.writeFileSync("/out", await fs.readFile("/out"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally {await shell.dispose();}
  }
  // The original next-style fixture is readable, but its unrelated H2→Char
  // edge fails complete publication validation. Retain it; never repair it here.
  if (invalidNextFixture) memory.writeFileSync("/out", input);
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of parts) if (!edits || name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new api.DocumentXmlEditor(after.get("word/styles.xml")!), nodes = xml.root.children.filter(n => n.localName === "style");
  const read = (node: api.XmlElement): Style => ({attrs: Object.fromEntries(node.attributes.filter(a => a.namespace === node.namespace).map(a => [a.localName, a.value])), children: node.children.map(n => ({tag: n.localName, attrs: Object.fromEntries(n.attributes.filter(a => a.namespace === node.namespace).map(a => [a.localName, a.value]))}))});
  const expected = c.deleted ? [] : c.styles.map((s, i) => i === (c.index ?? 0) && c.after ? c.after : s);
  expect(nodes.map(read)).toEqual(expected); const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊");
  const saved = new TextDecoder().decode(after.get("word/styles.xml")); expect(saved.split("<!--retain-->")).toHaveLength(2); expect(saved.split("<?audit keep?>")).toHaveLength(2);
});
