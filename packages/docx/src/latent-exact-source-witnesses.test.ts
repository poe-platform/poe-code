import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

type Case = {row: number; target: "entry" | "collection"; member: string; root?: Record<string, string>; entries: Record<string, string>[]; index?: number; key?: string; value?: unknown; expected?: unknown; after?: Record<string, string>; error?: "usage" | "missing-selection"};
const cases: Case[] = [
  {row: 585, target: "entry", member: "delete", entries: [{name: "Foo"}]},
  {row: 586, target: "entry", member: "name", entries: [{name: "heading 1"}], expected: "Heading 1"},
  {row: 587, target: "entry", member: "priority", entries: [{}], expected: null},
  {row: 588, target: "entry", member: "priority", entries: [{uiPriority: "42"}], expected: 42},
  {row: 589, target: "entry", member: "priority", entries: [{}], value: 42, after: {uiPriority: "42"}},
  {row: 590, target: "entry", member: "priority", entries: [{uiPriority: "42"}], value: 24, after: {uiPriority: "24"}},
  {row: 591, target: "entry", member: "priority", entries: [{uiPriority: "24"}], value: null, after: {}}
];
const flags = [["hidden", "semiHidden"], ["locked", "locked"], ["quick_style", "qFormat"], ["unhide_when_used", "unhideWhenUsed"]] as const;
for (const [state, stored] of [undefined, "1", "0"].entries()) for (const [index, [member, tag]] of flags.entries()) cases.push({row: 592 + state * 4 + index, target: "entry", member, entries: [stored === undefined ? {} : {[tag]: stored}], expected: state === 0 ? null : stored === "1"});
for (const [i, [member, tag, before, value]] of ([
  ["hidden", "semiHidden", undefined, true], ["hidden", "semiHidden", "1", false], ["hidden", "semiHidden", "0", null],
  ["locked", "locked", undefined, true], ["quick_style", "qFormat", undefined, false], ["unhide_when_used", "unhideWhenUsed", undefined, true], ["locked", "locked", "1", null]
] as const).entries()) cases.push({row: 604 + i, target: "entry", member, entries: [before === undefined ? {} : {[tag]: before}], value, after: value === null ? {} : {[tag]: String(Number(value))}});
cases.push({row: 611, target: "collection", member: "add_latent_style", entries: [], value: "Heading 1", after: {name: "heading 1"}});
for (let i = 0; i < 3; i++) for (const [offset, member] of [[612, "length"], [615, "iteration"]] as const) cases.push({row: offset + i, target: "collection", member, entries: Array.from({length: i}, () => ({})), expected: i});
for (const [i, key] of ["Ab", "Cd", "Ef", "Heading 1"].entries()) cases.push({row: 618 + i, target: "collection", member: "lookup", entries: i === 3 ? [{name: "heading 1"}] : Array.from({length: 3}, (_, n) => n === i ? {name: key} : {}), key, expected: i === 3 ? 0 : i});
cases.push({row: 622, target: "collection", member: "lookup", entries: [], key: "Foobar", error: "missing-selection"});
for (const [first, member, tag] of [[623, "default_priority", "defUIPriority"], [628, "load_count", "count"]] as const) {
  cases.push({row: first, target: "collection", member, root: {}, entries: [], expected: null}, {row: first + 1, target: "collection", member, root: {[tag]: "42"}, entries: [], expected: 42});
  for (const [i, [before, value]] of ([[undefined, 42], ["24", 42], ["24", null]] as const).entries()) cases.push({row: first + 2 + i, target: "collection", member, root: before === undefined ? {} : {[tag]: before}, entries: [], value, after: value === null ? {} : {[tag]: String(value)}});
}
const defaults = [["default_to_hidden", "defSemiHidden"], ["default_to_locked", "defLockedState"], ["default_to_quick_style", "defQFormat"], ["default_to_unhide_when_used", "defUnhideWhenUsed"]] as const;
for (const [i, [member, tag]] of defaults.entries()) {
  cases.push({row: 633 + i, target: "collection", member, entries: [], expected: false});
  const stored = ["1", "0", "on", "false"][i]!;
  cases.push({row: 637 + i, target: "collection", member, root: {[tag]: stored}, entries: [], expected: stored === "1" || stored === "on"});
  const value = i % 2 === 0; cases.push({row: 641 + i, target: "collection", member, entries: [], value, after: {[tag]: String(Number(value))}});
}
cases.push({row: 645, target: "collection", member: "default_to_hidden", root: {defSemiHidden: "0"}, entries: [], value: "Foo", error: "usage"}, {row: 646, target: "collection", member: "default_to_locked", root: {defLockedState: "1"}, entries: [], value: null, error: "usage"});
const attrs = (values: Record<string, string>) => Object.entries(values).map(([k, v]) => ` w:${k}="${v}"`).join(""), ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
expect(cases.map(c => c.row).sort((a, b) => a - b)).toEqual(Array.from({length: 62}, (_, i) => 585 + i));
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const original of cases)
for (const admitted of original.target === "entry" && Object.hasOwn(original, "value") ? [false, true] : [false]) for (const route of ["model", "sdk", "shell"])
it(`${route} independently executes exact latent source witness L${original.row}; strict=${strict}; kind=${kind}; fixture=${admitted ? "native-required-name-companion" : "original"}`, async () => {
  const c: Case = admitted ? {...original, entries: original.entries.map(e => ({...e, name: "Original Native"})), after: {...original.after, name: "Original Native"}} : original;
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:latentStyles${attrs(c.root ?? {})}>${c.entries.map(a => `<w:lsdException${attrs(a)}/>`).join("")}<!--retain--><?audit keep?></w:latentStyles></w:styles>`}}, strict)), memory = Volume.fromJSON({"/input": "", "/out": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, edits = Object.hasOwn(c, "value") || c.member === "delete", invalid = c.entries.some(e => !Object.hasOwn(e, "name")), operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.latent_styles.get", receiver: ref("styles"), arguments: {}, resultHandle: "latent"}
  ];
  if (c.target === "entry") operations.push({operation: "model.styles.latent.LatentStyles.__iter__.call", receiver: ref("latent"), arguments: {}, resultHandle: "items"});
  const prefix = c.target === "entry" ? "model.styles.latent._LatentStyle" : "model.styles.latent.LatentStyles", receiver = c.target === "entry" ? ref("items", c.index ?? 0) : ref("latent"), action = c.member === "length" ? "__len__.get" : c.member === "iteration" ? "__iter__.call" : c.member === "lookup" ? "__getitem__.call" : c.member === "add_latent_style" || c.member === "delete" ? c.member + ".call" : c.member + (edits ? ".set" : ".get");
  operations.push({operation: `${prefix}.${action}`, receiver, arguments: c.member === "lookup" ? {key: c.key} : c.member === "add_latent_style" ? {name: c.value} : Object.hasOwn(c, "value") ? {value: c.value} : {}, ...(["lookup", "add_latent_style"].includes(c.member) ? {resultHandle: "observed"} : {})});
  if (c.member === "lookup" && !c.error) operations.push({operation: "model.styles.latent._LatentStyle.name.get", receiver: ref("observed"), arguments: {}});
  if (c.member === "add_latent_style") operations.push({operation: "model.styles.latent._LatentStyle.name.get", receiver: ref("observed"), arguments: {}});
  const expectedEntries = c.member === "delete" ? [] : c.member === "add_latent_style" ? [c.after!] : c.target === "entry" && c.after ? c.entries.map((e, i) => i === (c.index ?? 0) ? c.after! : e) : c.entries, expectedRoot = c.target === "collection" && c.after && c.member !== "add_latent_style" ? c.after : c.root ?? {};
  const checkXml = (bytes: Uint8Array) => {const xml = new api.DocumentXmlEditor(bytes), root = xml.root.children.find(n => n.localName === "latentStyles")!, read = (n: api.XmlElement) => Object.fromEntries(n.attributes.filter(a => a.namespace === n.namespace).map(a => [a.localName, a.value])); expect(read(root)).toEqual(expectedRoot); expect(root.children.map(read)).toEqual(expectedEntries);};
  const observe = (values: unknown[]) => {if (c.member === "iteration") {const items = values.at(-1) as {type: string}[]; expect(items).toHaveLength(c.expected as number); for (const item of items) expect(item.type).toBe("_LatentStyle");} else if (c.member === "lookup" || c.member === "add_latent_style") expect(values.at(-1)).toBe(c.member === "add_latent_style" ? "Heading 1" : c.key); else if (!edits) expect(values.at(-1)).toEqual(c.expected);};
  if (route === "shell" && invalid) {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
    try {const result = await shell.exec("docx styles latent list /input --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const data = JSON.parse(result.stdout).data; expect(data.latent.entries).toHaveLength(c.entries.length); expect(data.diagnostics.filter((d: {code: string}) => d.code === "latent-name")).toHaveLength(c.entries.filter(e => !Object.hasOwn(e, "name")).length);
      if (!edits) {if (["length", "iteration"].includes(c.member)) expect(data.latent.entries).toHaveLength(c.expected as number); else if (c.member === "lookup") expect(data.latent.entries[c.expected as number].name).toBe(c.key); else {const key = c.member === "quick_style" ? "quickStyle" : c.member === "unhide_when_used" ? "unhideWhenUsed" : c.member; expect(data.latent.entries[c.index ?? 0][key]).toEqual(c.expected);}}
      expect(await fs.readFile("/input")).toEqual(input);
    } finally {await shell.dispose();}
  }
  if (route === "model") {const doc = await api.Document(input, textContext), latent = doc.styles.latent_styles, selected = c.target === "entry" ? [...latent][c.index ?? 0]! : latent; const run = () => {if (c.member === "delete") {const entry = selected as api.LatentStyle; entry.delete(); expect(() => entry.name).toThrow(api.StaleHandleError); expect(() => entry.element).toThrow(api.StaleHandleError);} else if (c.member === "add_latent_style") {const added = latent.add_latent_style(c.value as string); expect(added.name).toBe("Heading 1"); expect(added.equals([...latent][0])).toBe(true); expect(added.element.tag).toEqual(latent.element.children[0]!.tag); expect([...added.element.attributes]).toEqual([...latent.element.children[0]!.attributes]); expect(added.part).toBe(latent.part);} else if (c.member === "lookup") expect(latent.at(c.key!).equals([...latent][c.expected as number])).toBe(true); else if (c.member === "length") expect(latent.length).toBe(c.expected); else if (c.member === "iteration") {expect([...latent]).toHaveLength(c.expected as number); for (const entry of latent) expect(entry).toBeInstanceOf(api.LatentStyle);} else if (edits) Reflect.set(selected, c.member, c.value); else expect(Reflect.get(selected, c.member)).toEqual(c.expected);};
    if (c.error || invalid && edits) {expect(run).toThrow(c.error === "usage" ? TypeError : c.error ? api.MissingKeyError : api.SemanticValidationError); expect(doc.styles.part.blob).toEqual(parts.get("word/styles.xml"));} else {run(); checkXml(doc.styles.part.blob); if (invalid) await expect(doc.save(sink)).rejects.toMatchObject({code: "invalid-package"}); else await doc.save(sink);}}
  else if (route === "sdk") {if (c.error || invalid && edits) await expect(api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).rejects.toMatchObject({code: c.error ?? "invalid-package"}); else {const result = await api.applyStyleModelBatch(input, {version: 1, operations}, textContext); observe(result.results.map(r => r.value)); if (invalid) await expect(result.save(sink)).rejects.toMatchObject({code: "invalid-package"}); else await result.save(sink);}}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination")); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --force --json`), expectedCode = c.error ? c.error : invalid ? "invalid-package" : undefined; expect(result.exitCode, result.stdout + result.stderr).toBe(expectedCode === "usage" ? 2 : expectedCode ? 1 : 0); if (expectedCode) {expect(JSON.parse(result.stdout).errors[0].code).toBe(expectedCode); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");} else {observe(JSON.parse(result.stdout).data.results.map((r: {data: unknown}) => r.data)); memory.writeFileSync("/out", await fs.readFile("/out"));} expect(await fs.readFile("/input")).toEqual(input);} finally {await shell.dispose();}}
  if (c.error || invalid) expect(memory.readFileSync("/out")).toEqual(Buffer.from("")); else {const after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(after); for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes); checkXml(after.get("word/styles.xml")!); const saved = new TextDecoder().decode(after.get("word/styles.xml")); expect(saved.split("<!--retain-->")).toHaveLength(2); expect(saved.split("<?audit keep?>")).toHaveLength(2); if (!edits) expect(after.get("word/styles.xml")).toEqual(parts.get("word/styles.xml"));}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
