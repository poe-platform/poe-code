import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

type Native = {attrs: Record<string, string>; name?: string};
type Case = {row: number; member: string; styles: Native[]; key?: string; styleType?: string | number; styleId?: string | number | null; value?: string | number | null; builtin?: boolean; expected?: unknown; owner?: number; error?: "usage" | "missing-selection"; invalidDefault?: boolean; latent?: boolean; companion?: boolean};
const style = (attrs: Record<string, string> = {}, name?: string): Native => ({attrs, ...(name === undefined ? {} : {name})});
const cases: Case[] = [
  {row: 730, member: "has", styles: [style({}, "heading 1")], key: "Heading 1", expected: true},
  {row: 731, member: "has", styles: [style({}, "Foo Bar")], key: "Foo Bar", expected: true},
  {row: 732, member: "has", styles: [style({}, "heading 1")], key: "Foobar", expected: false},
  {row: 733, member: "has", styles: [], key: "Foobar", expected: false}
];
for (let i = 0; i < 4; i++) for (const [offset, member] of [[734, "length"], [738, "iteration"]] as const) cases.push({row: offset + i, member, styles: Array.from({length: i}, () => style()), expected: i});
for (let i = 0; i < 3; i++) cases.push({row: 742 + i, member: "at", styles: Array.from({length: 3}, (_, n) => n === i ? style({type: "paragraph", styleId: "Foobar"}) : style()), key: "Foobar", expected: i});
cases.push(
  {row: 745, member: "at", styles: [style({type: "character"}, "foo"), style()], key: "foo", expected: 0},
  {row: 746, member: "at", styles: [style(), style({type: "character"}, "foo")], key: "foo", expected: 1},
  {row: 747, member: "at", styles: [style({type: "character"}, "heading 1")], key: "Heading 1", expected: 0},
  {row: 748, member: "at", styles: [style(), style({}, "foo"), style()], key: "bar", error: "missing-selection"},
  {row: 749, member: "at", styles: [style({styleId: "foo"}), style(), style()], key: "bar", error: "missing-selection"},
  {row: 750, member: "add_style", styles: [], key: "Foo Bar", styleType: "CHARACTER", builtin: false},
  {row: 751, member: "add_style", styles: [], key: "Heading 1", styleType: "PARAGRAPH", builtin: true},
  {row: 752, member: "add_style", styles: [style({}, "heading 1")], key: "Heading 1", styleType: "PARAGRAPH", error: "usage"},
  {row: 753, member: "default", styles: [], styleType: "CHARACTER", expected: null},
  {row: 754, member: "default", styles: [style({type: "paragraph", default: "1"})], styleType: "PARAGRAPH", expected: 0},
  {row: 755, member: "default", styles: [style({type: "table", default: "1"}), style({type: "table", default: "1"})], styleType: "TABLE", expected: 1, invalidDefault: true},
  {row: 756, member: "get_by_id", styles: [], styleId: 42, styleType: 7, error: "usage"},
  {row: 757, member: "get_by_id", styles: [], styleId: null, styleType: 17, error: "usage"},
  {row: 758, member: "get_style_id", styles: [style({styleId: "StyleId"})], owner: 0, styleType: 22, error: "usage"},
  {row: 759, member: "get_style_id", styles: [style({styleId: "StyleId"}, "Style Name")], value: "Style Name", styleType: 22, error: "usage"},
  {row: 760, member: "get_style_id", styles: [], value: null, styleType: 22, error: "usage"},
  {row: 761, member: "get_by_id", styles: [style({type: "paragraph", styleId: "Foo"})], styleId: "Foo", styleType: "PARAGRAPH", expected: 0},
  {row: 762, member: "get_by_id", styles: [style({type: "paragraph", styleId: "Foo"})], styleId: "Bar", styleType: "PARAGRAPH", expected: null},
  {row: 763, member: "get_by_id", styles: [style({type: "table", styleId: "Bar"})], styleId: "Bar", styleType: "PARAGRAPH", expected: null},
  {row: 764, member: "get_style_id", styles: [style({styleId: "FooBar"}, "Foo Bar")], value: "Foo Bar", styleType: "PARAGRAPH", expected: "FooBar"},
  {row: 765, member: "get_style_id", styles: [style({styleId: "FooBar", default: "1"})], owner: 0, styleType: "PARAGRAPH", expected: null},
  {row: 766, member: "get_style_id", styles: [style({styleId: "FooBar"})], owner: 0, styleType: "PARAGRAPH", expected: "FooBar"},
  {row: 767, member: "get_style_id", styles: [style({type: "paragraph"})], owner: 0, styleType: "CHARACTER", error: "usage"},
  {row: 768, member: "latent_styles", styles: [], latent: true}
);
expect(cases.map(c => c.row).sort((a, b) => a - b)).toEqual(Array.from({length: 39}, (_, i) => 730 + i));
// Mock-only source constants do not grant invalid enum/numeric ID authority.
// Keep each raw rejection and independently exercise its admitted helper path.
const companions: Case[] = [
  {row: 756, member: "get_by_id", styles: [style({styleId: "42"})], styleId: "42", styleType: "PARAGRAPH", expected: 0, companion: true},
  {row: 757, member: "get_by_id", styles: [style({styleId: "Default", default: "1"})], styleId: null, styleType: "PARAGRAPH", expected: 0, companion: true},
  {row: 758, member: "get_style_id", styles: [style({styleId: "StyleId"})], owner: 0, styleType: "PARAGRAPH", expected: "StyleId", companion: true},
  {row: 759, member: "get_style_id", styles: [style({styleId: "StyleId"}, "Style Name")], value: "Style Name", styleType: "PARAGRAPH", expected: "StyleId", companion: true},
  {row: 760, member: "get_style_id", styles: [], value: null, styleType: "PARAGRAPH", expected: null, companion: true}
];
const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const c of [...cases, ...companions]) for (const route of ["model", "sdk", "shell"])
it(`${route} independently executes exact styles collection witness C${c.row}; strict=${strict}; kind=${kind}; fixture=${c.companion ? "admitted-helper-companion" : "original"}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}">${c.styles.map(s => `<w:style${Object.entries(s.attrs).map(([k, v]) => ` w:${k}="${v}"`).join("")}>${s.name === undefined ? "" : `<w:name w:val="${s.name}"/>`}</w:style>`).join("")}${c.latent ? '<w:latentStyles w:defUIPriority="42"/>' : ""}<!--retain--><?audit keep?></w:styles>`}}, strict)), memory = Volume.fromJSON({"/input": "", "/out": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, type = typeof c.styleType === "string" ? api.WD_STYLE_TYPE[c.styleType as keyof typeof api.WD_STYLE_TYPE] : c.styleType, args: Record<string, unknown> = c.member === "has" ? {value: c.key} : c.member === "at" ? {key: c.key} : c.member === "add_style" ? {name: c.key, styleType: type, builtin: c.builtin ?? false} : c.member === "default" ? {styleType: type} : c.member === "get_by_id" ? {styleId: c.styleId, styleType: type} : c.member === "get_style_id" ? {styleOrName: c.owner === undefined ? c.value : ref("items", c.owner), styleType: type} : {},
    action = c.member === "has" ? "__contains__.call" : c.member === "at" ? "__getitem__.call" : c.member === "length" ? "__len__.get" : c.member === "iteration" ? "__iter__.call" : c.member === "latent_styles" ? "latent_styles.get" : c.member + ".call", operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [{operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"}, {operation: "model.styles.styles.Styles.__iter__.call", receiver: ref("styles"), arguments: {}, resultHandle: "items"}, {operation: `model.styles.styles.Styles.${action}`, receiver: ref("styles"), arguments: args, resultHandle: "observed"}];
  if (["at", "default", "get_by_id"].includes(c.member) && !c.error && c.expected !== null) operations.push({operation: "model.styles.style.BaseStyle.__eq__.call", receiver: ref("observed"), arguments: {other: ref("items", c.expected as number)}});
  if (c.member === "add_style" && !c.error) operations.push({operation: "model.styles.style.BaseStyle.name.get", receiver: ref("observed"), arguments: {}}, {operation: "model.styles.style.BaseStyle.type.get", receiver: ref("observed"), arguments: {}}, {operation: "model.styles.style.BaseStyle.builtin.get", receiver: ref("observed"), arguments: {}});
  if (c.member === "latent_styles") operations.push({operation: "model.styles.latent.LatentStyles.default_priority.get", receiver: ref("observed"), arguments: {}});
  const observe = (values: unknown[]) => {if (c.member === "iteration") {const found = values.at(-1) as {type: string}[]; expect(found).toHaveLength(c.expected as number); expect(found.map(v => v.type)).toEqual(Array.from({length: c.expected as number}, () => "ParagraphStyle"));} else if (["at", "default", "get_by_id"].includes(c.member)) expect(values.at(-1)).toBe(c.expected === null ? null : true); else if (c.member === "add_style") expect(values.slice(-3)).toEqual([c.key, type, c.builtin]); else if (c.member === "latent_styles") expect(values.at(-1)).toBe(42); else expect(values.at(-1)).toEqual(c.expected);};
  if (route === "model") {const doc = await api.Document(input, textContext), styles = doc.styles, items = [...styles], run = () => {
    if (c.member === "has") expect(styles.has(c.key!)).toBe(c.expected); else if (c.member === "length") expect(styles.length).toBe(c.expected); else if (c.member === "iteration") {expect([...styles]).toHaveLength(c.expected as number); for (const [i, value] of [...styles].entries()) {expect(value).toBeInstanceOf(api.ParagraphStyle); expect(value.equals(items[i])).toBe(true);}}
    else if (c.member === "add_style") {const added = styles.add_style(c.key!, type as api.DocxEnumValue<"WD_STYLE_TYPE">, c.builtin); expect(added.name).toBe(c.key); expect(added.type).toEqual(type); expect(added.builtin).toBe(c.builtin); expect(added.equals([...styles].at(-1))).toBe(true);}
    else if (c.member === "get_style_id") expect(styles.get_style_id(c.owner === undefined ? c.value as string | null : items[c.owner]!, type as api.DocxEnumValue<"WD_STYLE_TYPE">)).toBe(c.expected);
    else if (c.member === "latent_styles") {const first = styles.latent_styles; expect(first.equals(styles.latent_styles)).toBe(true); expect(first.default_priority).toBe(42); expect(first.part).toBe(styles.part);}
    else {const value = c.member === "at" ? styles.at(c.key!) : c.member === "default" ? styles.default(type as api.DocxEnumValue<"WD_STYLE_TYPE">) : styles.get_by_id(c.styleId as string | null, type as api.DocxEnumValue<"WD_STYLE_TYPE">); expect(value === null ? null : value.equals(items[c.expected as number])).toBe(c.expected === null ? null : true);}
  }; if (c.error) {expect(run).toThrow(c.row === 752 ? api.InvalidValueError : c.error === "missing-selection" ? api.MissingKeyError : TypeError); expect(styles.part.blob).toEqual(parts.get("word/styles.xml"));} else {run(); if (c.invalidDefault) await expect(doc.save(sink)).rejects.toMatchObject({code: "invalid-package"}); else await doc.save(sink);}}
  else if (route === "sdk") {if (c.error) await expect(api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).rejects.toMatchObject({code: c.error}); else {const result = await api.applyStyleModelBatch(input, {version: 1, operations}, textContext); observe(result.results.map(r => r.value)); if (c.invalidDefault) await expect(result.save(sink)).rejects.toMatchObject({code: "invalid-package"}); else await result.save(sink);}}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination")); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {
    if (c.invalidDefault) {const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", readOps = [{operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"}, {operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("part"), arguments: {reltype: `${r}/styles`}, resultHandle: "stylesPart"}, {operation: "model.parts.styles.StylesPart.styles.get", receiver: ref("stylesPart"), arguments: {}, resultHandle: "styles"}, ...operations.slice(1)], read = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations: readOps})}' --json`); expect(read.exitCode, read.stdout + read.stderr).toBe(0); observe(JSON.parse(read.stdout).data.results.slice(2).map((r: {data: unknown}) => r.data));}
    const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --force --json`), expectedCode = c.error ?? (c.invalidDefault ? "invalid-package" : undefined); expect(result.exitCode, result.stdout + result.stderr).toBe(expectedCode === "usage" ? 2 : expectedCode ? 1 : 0); if (expectedCode) {expect(JSON.parse(result.stdout).errors[0].code).toBe(expectedCode); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");} else {observe(JSON.parse(result.stdout).data.results.map((r: {data: unknown}) => r.data)); memory.writeFileSync("/out", await fs.readFile("/out"));} expect(await fs.readFile("/input")).toEqual(input);
  } finally {await shell.dispose();}}
  if (c.error || c.invalidDefault) expect(memory.readFileSync("/out")).toEqual(Buffer.from("")); else {const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes); const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); const saved = new TextDecoder().decode(after.get("word/styles.xml")); expect(saved.split("<!--retain-->")).toHaveLength(2); expect(saved.split("<?audit keep?>")).toHaveLength(2); if (c.member !== "add_style") expect(after.get("word/styles.xml")).toEqual(parts.get("word/styles.xml")); else {const xml = new api.DocumentXmlEditor(after.get("word/styles.xml")!), node = xml.root.children.at(-1)!; expect(node.attributes.find(a => a.namespace === node.namespace && a.localName === "type")?.value).toBe(c.styleType === "PARAGRAPH" ? "paragraph" : "character"); expect(node.attributes.find(a => a.namespace === node.namespace && a.localName === "customStyle")?.value).toBe(c.builtin ? undefined : "1"); expect(node.children[0]!.attributes[0]!.value).toBe(c.key === "Heading 1" ? "heading 1" : c.key);}}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
