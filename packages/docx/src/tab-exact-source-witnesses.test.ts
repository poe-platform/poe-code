import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

type Attrs = {pos: number; val: string; leader?: string};
type Case = {id: number; action: "position-get" | "position-set" | "alignment-get" | "alignment-set" | "leader-get" | "leader-set" | "length" | "iterate" | "index" | "add" | "delete" | "clear"; tabs: readonly Attrs[]; value?: number | string | null; index?: number; newIndex?: number; leader?: string; expected?: unknown; after?: readonly Attrs[]; reject?: boolean};
const cases: readonly Case[] = [
  {id: 0, action: "position-get", tabs: [{pos: 720, val: "center"}], expected: 457200},
  {id: 1, action: "position-set", tabs: [{pos: 360, val: "left"}], value: 720, newIndex: 0, after: [{pos: 720, val: "left"}]},
  {id: 2, action: "position-set", tabs: [{pos: 360, val: "left"}, {pos: 720, val: "left"}], value: 180, newIndex: 0, after: [{pos: 180, val: "left"}, {pos: 720, val: "left"}]},
  {id: 3, action: "position-set", tabs: [{pos: 360, val: "left"}, {pos: 720, val: "left"}], value: 960, newIndex: 1, after: [{pos: 720, val: "left"}, {pos: 960, val: "left"}]},
  {id: 4, action: "position-set", tabs: [{pos: -72, val: "left"}, {pos: -36, val: "left"}], value: -48, newIndex: 0, after: [{pos: -48, val: "left"}, {pos: -36, val: "left"}]},
  {id: 5, action: "position-set", tabs: [{pos: -72, val: "left"}, {pos: -36, val: "left"}], value: -16, newIndex: 1, after: [{pos: -36, val: "left"}, {pos: -16, val: "left"}]},
  {id: 6, action: "alignment-get", tabs: [{pos: 720, val: "left"}], expected: "LEFT"},
  {id: 7, action: "alignment-get", tabs: [{pos: 720, val: "right"}], expected: "RIGHT"},
  {id: 8, action: "alignment-set", tabs: [{pos: 720, val: "left"}], value: "RIGHT", after: [{pos: 720, val: "right"}]},
  {id: 9, action: "alignment-set", tabs: [{pos: 720, val: "right"}], value: "LEFT", after: [{pos: 720, val: "left"}]},
  {id: 10, action: "leader-get", tabs: [{pos: 720, val: "center"}], expected: "SPACES"},
  {id: 11, action: "leader-get", tabs: [{pos: 720, val: "center", leader: "none"}], expected: "SPACES"},
  {id: 12, action: "leader-get", tabs: [{pos: 720, val: "center", leader: "dot"}], expected: "DOTS"},
  {id: 13, action: "leader-set", tabs: [{pos: 720, val: "center"}], value: "DOTS", after: [{pos: 720, val: "center", leader: "dot"}]},
  {id: 14, action: "leader-set", tabs: [{pos: 720, val: "center", leader: "dot"}], value: "DASHES", after: [{pos: 720, val: "center", leader: "hyphen"}]},
  {id: 15, action: "leader-set", tabs: [{pos: 720, val: "center", leader: "hyphen"}], value: "SPACES", after: [{pos: 720, val: "center"}]},
  {id: 16, action: "leader-set", tabs: [{pos: 720, val: "center", leader: "hyphen"}], value: null, after: [{pos: 720, val: "center"}]},
  {id: 17, action: "leader-set", tabs: [{pos: 720, val: "center"}], value: "SPACES", after: [{pos: 720, val: "center"}]},
  {id: 18, action: "leader-set", tabs: [{pos: 720, val: "center"}], value: null, after: [{pos: 720, val: "center"}]},
  {id: 19, action: "length", tabs: [], expected: 0},
  {id: 20, action: "length", tabs: [{pos: 2880, val: "center"}], expected: 1},
  {id: 21, action: "iterate", tabs: [], expected: []},
  {id: 22, action: "iterate", tabs: [{pos: 2880, val: "center"}], expected: [2880]},
  {id: 23, action: "iterate", tabs: [{pos: 2880, val: "center"}, {pos: 5760, val: "center"}], expected: [2880, 5760]},
  {id: 24, action: "index", tabs: [{pos: 0, val: "center"}], index: 0, expected: 0},
  {id: 25, action: "index", tabs: [{pos: 1, val: "center"}, {pos: 2, val: "center"}, {pos: 3, val: "center"}], index: 1, expected: 1270},
  {id: 26, action: "index", tabs: [{pos: 4, val: "center"}, {pos: 5, val: "center"}, {pos: 6, val: "center"}], index: 2, expected: 3810},
  {id: 27, action: "index", tabs: [], index: 0, reject: true},
  {id: 28, action: "add", tabs: [], value: 42, after: [{pos: 42, val: "left"}]},
  {id: 29, action: "add", tabs: [], value: 72, expected: "RIGHT", after: [{pos: 72, val: "right"}]},
  {id: 30, action: "add", tabs: [], value: 24, expected: "CENTER", leader: "DOTS", after: [{pos: 24, val: "center", leader: "dot"}]},
  {id: 31, action: "add", tabs: [{pos: 42, val: "center"}], value: 72, after: [{pos: 42, val: "center"}, {pos: 72, val: "left"}]},
  {id: 32, action: "add", tabs: [{pos: 42, val: "center"}], value: 24, after: [{pos: 24, val: "left"}, {pos: 42, val: "center"}]},
  {id: 33, action: "add", tabs: [{pos: 42, val: "center"}], value: 42, after: [{pos: 42, val: "center"}, {pos: 42, val: "left"}]},
  {id: 34, action: "delete", tabs: [{pos: 42, val: "center"}], index: 0, after: []},
  {id: 35, action: "delete", tabs: [{pos: 24, val: "center"}, {pos: 42, val: "center"}], index: 0, after: [{pos: 42, val: "center"}]},
  {id: 36, action: "delete", tabs: [{pos: 24, val: "center"}, {pos: 42, val: "center"}], index: 1, after: [{pos: 24, val: "center"}]},
  {id: 37, action: "delete", tabs: [], index: 0, reject: true},
  {id: 38, action: "delete", tabs: [{pos: 42, val: "center"}], index: 1, reject: true},
  {id: 39, action: "clear", tabs: [], after: []},
  {id: 40, action: "clear", tabs: [{pos: 42, val: "center"}], after: []},
  {id: 41, action: "clear", tabs: [{pos: 24, val: "center"}, {pos: 42, val: "center"}], after: []}
];
const ref = (resultHandle: string) => ({resultHandle});
const directional = (value: string, strict: boolean) => strict ? ({left: "start", right: "end", LEFT: "START", RIGHT: "END"}[value] ?? value) : value;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const c of cases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact tab source witness T${String(c.id).padStart(2, "0")}; strict=${strict}; kind=${kind}`, async () => {
  const tabXml = c.tabs.map(t => `<w:tab w:pos="${t.pos}" w:val="${directional(t.val, strict)}"${t.leader === undefined ? "" : ` w:leader="${t.leader}"`}/>`).join(""), {input} = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p w:rsidR="00ABCDEF"><w:pPr>${c.tabs.length ? `<w:tabs>${tabXml}</w:tabs>` : ""}</w:pPr><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r><!--retain--><?audit keep?></w:p>`), memory = Volume.fromJSON({"/out": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, edits = c.after !== undefined;
  const ops: {operation: string; receiver: {resultHandle: string; index?: number}; arguments: Record<string, unknown>; resultHandle?: string}[] = [
    {operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "stops"}
  ];
  if (c.action === "length") ops.push({operation: "model.text.tabstops.TabStops.__len__.get", receiver: ref("stops"), arguments: {}});
  else if (c.action === "iterate") {
    ops.push({operation: "model.text.tabstops.TabStops.__iter__.call", receiver: ref("stops"), arguments: {}, resultHandle: "items"});
    c.tabs.forEach((_, index) => ops.push({operation: "model.text.tabstops.TabStop.position.get", receiver: {resultHandle: "items", index}, arguments: {}}));
  } else if (c.action === "clear") ops.push({operation: "model.text.tabstops.TabStops.clear_all.call", receiver: ref("stops"), arguments: {}});
  else if (c.action === "delete") ops.push({operation: "model.text.tabstops.TabStops.__delitem__.call", receiver: ref("stops"), arguments: {index: c.index}});
  else if (c.action === "add") ops.push({operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: ref("stops"), arguments: {position: {value: c.value, unit: "twip"}, ...(c.expected === undefined ? {} : {alignment: {enum: "WD_TAB_ALIGNMENT", name: c.expected}}), ...(c.leader ? {leader: {enum: "WD_TAB_LEADER", name: c.leader}} : {})}, resultHandle: "stop"});
  else {
    ops.push({operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("stops"), arguments: {index: c.index ?? 0}, resultHandle: "stop"});
    if (!c.reject) {
      const [member, access] = c.action === "index" ? ["position", "get"] : c.action.split("-");
      const value = member === "position" ? {value: c.value, unit: "twip"} : c.value === null ? null : {enum: member === "alignment" ? "WD_TAB_ALIGNMENT" : "WD_TAB_LEADER", name: c.value};
      ops.push({operation: `model.text.tabstops.TabStop.${member}.${access}`, receiver: ref("stop"), arguments: access === "set" ? {value} : {}});
      if (c.action === "position-set") ops.push({operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("stops"), arguments: {index: c.newIndex}, resultHandle: "moved"}, {operation: "model.text.tabstops.TabStop.__eq__.call", receiver: ref("stop"), arguments: {other: ref("moved")}});
    }
  }
  function observe(values: readonly unknown[]) {
    if (c.action === "iterate") expect(values.slice(4)).toEqual(c.tabs.map(t => ({value: t.pos * 635, unit: "emu"})));
    else if (c.action === "length") expect(values.at(-1)).toBe(c.expected);
    else if (c.action === "position-get" || c.action === "index") expect(values.at(-1)).toEqual({value: c.expected, unit: "emu"});
    else if (c.action === "alignment-get" || c.action === "leader-get") expect(values.at(-1)).toEqual({enum: c.action === "alignment-get" ? "WD_TAB_ALIGNMENT" : "WD_TAB_LEADER", name: directional(c.expected as string, strict)});
    else if (c.action === "position-set") expect(values.at(-1)).toBe(true);
  }
  if (route === "model") {
    const doc = await api.Document(input, textContext), tabs = doc.paragraphs[0]!.paragraph_format.tab_stops;
    if (c.reject) {expect(() => c.action === "index" ? tabs.at(c.index!) : tabs.delete(c.index!)).toThrow(api.BoundsError); await doc.save(sink); expect(new Uint8Array(memory.readFileSync("/out") as Buffer)).toEqual(input); return;}
    if (c.action === "length") expect(tabs.length).toBe(c.expected);
    else if (c.action === "iterate") {const stops = [...tabs]; expect(stops.map(t => t.position.twips)).toEqual(c.expected); stops.forEach((stop, i) => expect(stop.equals(tabs.at(i))).toBe(true));}
    else if (c.action === "index" || c.action === "position-get") expect(tabs.at(c.index ?? 0).position.emu).toBe(c.expected);
    else if (c.action === "alignment-get" || c.action === "leader-get") expect(Reflect.get(tabs.at(0), c.action.split("-")[0]!).name).toBe(directional(c.expected as string, strict));
    else if (c.action === "position-set") {const stop = tabs.at(0), detached = tabs.element.children[0]!; stop.position = api.Twips(c.value as number); expect(stop.equals(tabs.at(c.newIndex!))).toBe(true); expect(stop.element.serialize()).toEqual(tabs.at(c.newIndex!).element.serialize()); expect(() => detached.serialize()).toThrow(api.StaleHandleError);}
    else if (c.action === "alignment-set") tabs.at(0).alignment = api.WD_TAB_ALIGNMENT[c.value as api.DocxEnumNames["WD_TAB_ALIGNMENT"]];
    else if (c.action === "leader-set") tabs.at(0).leader = c.value === null ? null : api.WD_TAB_LEADER[c.value as api.DocxEnumNames["WD_TAB_LEADER"]];
    else if (c.action === "add") tabs.add_tab_stop(api.Twips(c.value as number), c.expected === undefined ? undefined : api.WD_TAB_ALIGNMENT[c.expected as api.DocxEnumNames["WD_TAB_ALIGNMENT"]], c.leader === undefined ? undefined : api.WD_TAB_LEADER[c.leader as api.DocxEnumNames["WD_TAB_LEADER"]]);
    else if (c.action === "delete") tabs.delete(c.index!); else tabs.clear_all();
    await doc.save(sink);
  } else if (route === "sdk") {
    if (c.reject) {await expect(api.applyStyleModelBatch(input, {version: 1, operations: ops}, textContext)).rejects.toMatchObject({code: "missing-selection"}); expect(memory.readFileSync("/out")).toHaveLength(0); return;}
    const result = await api.applyStyleModelBatch(input, {version: 1, operations: ops}, textContext); observe(result.results.map(r => r.value)); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
    try {const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations: ops})}' --json --output /out`); expect(await fs.readFile("/input")).toEqual(input); if (c.reject) {expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("missing-selection"); await expect(fs.readFile("/out")).rejects.toBeDefined(); return;} expect(result.exitCode, result.stdout + result.stderr).toBe(0); observe(JSON.parse(result.stdout).data.results.map((r: {data: unknown}) => r.data)); memory.writeFileSync("/out", await fs.readFile("/out"));} finally {await shell.dispose();}
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [part, bytes] of before) if (!edits || part !== "word/document.xml") expect(after.get(part), part).toEqual(bytes);
  const xml = new api.DocumentXmlEditor(after.get("word/document.xml")!), p = xml.root.children[0]!.children[0]!, pPr = p.children.find(n => n.localName === "pPr"), tabs = pPr?.children.find(n => n.localName === "tabs"); expect(pPr).toBeDefined();
  const expected = c.after ?? c.tabs; expect(Boolean(tabs)).toBe(expected.length > 0); expect(tabs?.children.map(n => Object.fromEntries(n.attributes.filter(a => a.namespace === p.namespace).map(a => [a.localName, a.value]))) ?? []).toEqual(expected.map(t => ({pos: String(t.pos), val: directional(t.val, strict), ...(t.leader === undefined ? {} : {leader: t.leader})})));
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); const text = new TextDecoder().decode(after.get("word/document.xml")); for (const retained of ['w:rsidR="00ABCDEF"', '<!--retain-->', '<?audit keep?>']) expect(text.split(retained)).toHaveLength(2);
});
