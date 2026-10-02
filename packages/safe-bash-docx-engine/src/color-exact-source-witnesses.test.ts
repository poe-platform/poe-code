import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

type Color = { val?: string; themeColor?: string };
type Case = { id: number; rPr: boolean; before?: Color; member: "type" | "rgb" | "theme_color"; value?: readonly [number, number, number] | string | null; expected?: string | null; after?: Color | null };
const cases: readonly Case[] = [
  { id: 0, rPr: false, member: "type", expected: null }, { id: 1, rPr: true, member: "type", expected: null },
  { id: 2, rPr: true, before: { val: "auto" }, member: "type", expected: "AUTO" },
  { id: 3, rPr: true, before: { val: "4224FF" }, member: "type", expected: "RGB" },
  { id: 4, rPr: true, before: { themeColor: "dark1" }, member: "type", expected: "THEME" },
  { id: 5, rPr: true, before: { val: "F00BA9", themeColor: "accent1" }, member: "type", expected: "THEME" },
  { id: 6, rPr: false, member: "rgb", expected: null }, { id: 7, rPr: true, member: "rgb", expected: null },
  { id: 8, rPr: true, before: { val: "auto" }, member: "rgb", expected: null },
  { id: 9, rPr: true, before: { val: "4224FF" }, member: "rgb", expected: "4224FF" },
  { id: 10, rPr: true, before: { val: "auto", themeColor: "accent1" }, member: "rgb", expected: null },
  { id: 11, rPr: true, before: { val: "F00BA9", themeColor: "accent1" }, member: "rgb", expected: "F00BA9" },
  { id: 12, rPr: false, member: "rgb", value: [10, 20, 30], after: { val: "0A141E" } },
  { id: 13, rPr: true, member: "rgb", value: [1, 2, 3], after: { val: "010203" } },
  { id: 14, rPr: true, before: { val: "123abc" }, member: "rgb", value: [42, 24, 99], after: { val: "2A1863" } },
  { id: 15, rPr: true, before: { val: "auto" }, member: "rgb", value: [16, 17, 18], after: { val: "101112" } },
  { id: 16, rPr: true, before: { val: "234bcd", themeColor: "dark1" }, member: "rgb", value: [24, 42, 99], after: { val: "182A63" } },
  { id: 17, rPr: true, before: { val: "234bcd", themeColor: "dark1" }, member: "rgb", value: null, after: null },
  { id: 18, rPr: false, member: "rgb", value: null, after: null },
  { id: 19, rPr: false, member: "theme_color", expected: null }, { id: 20, rPr: true, member: "theme_color", expected: null },
  { id: 21, rPr: true, before: { val: "auto" }, member: "theme_color", expected: null },
  { id: 22, rPr: true, before: { val: "4224FF" }, member: "theme_color", expected: null },
  { id: 23, rPr: true, before: { themeColor: "accent1" }, member: "theme_color", expected: "ACCENT_1" },
  { id: 24, rPr: true, before: { val: "F00BA9", themeColor: "dark1" }, member: "theme_color", expected: "DARK_1" },
  { id: 25, rPr: false, member: "theme_color", value: "ACCENT_1", after: { val: "000000", themeColor: "accent1" } },
  { id: 26, rPr: true, member: "theme_color", value: "ACCENT_2", after: { val: "000000", themeColor: "accent2" } },
  { id: 27, rPr: true, before: { val: "101112" }, member: "theme_color", value: "ACCENT_3", after: { val: "101112", themeColor: "accent3" } },
  { id: 28, rPr: true, before: { val: "234bcd", themeColor: "dark1" }, member: "theme_color", value: "LIGHT_2", after: { val: "234bcd", themeColor: "light2" } },
  { id: 29, rPr: true, before: { val: "234bcd", themeColor: "dark1" }, member: "theme_color", value: null, after: null },
  { id: 30, rPr: false, member: "theme_color", value: null, after: null }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const c of cases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact color source witness C${String(c.id).padStart(2, "0")}; strict=${strict}; kind=${kind}`, async () => {
  const colorXml = c.before ? `<w:color ${Object.entries(c.before).map(([key, value]) => `w:${key}="${value}"`).join(" ")}/>` : "", { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:r w:rsidR="00ABCDEF">${c.rPr ? `<w:rPr>${colorXml}</w:rPr>` : ""}<w:t>Original é 日本 עברית 🌊</w:t></w:r><!--retain--><?audit keep?></w:p>`), memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, edits = Object.hasOwn(c, "value");
  const operations: api.DocxBatchOperation[] = [{ operation: "runs.get", arguments: { paragraph: 1, run: 1 }, resultHandle: "run" }, { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "run" }, arguments: {}, resultHandle: "font" }, { operation: "model.text.run.Font.color.get", receiver: { resultHandle: "font" }, arguments: {}, resultHandle: "color" }];
  if (edits) operations.push({ operation: `model.dml.color.ColorFormat.${c.member}.set`, receiver: { resultHandle: "color" }, arguments: { value: c.value === null ? null : typeof c.value === "string" ? { enum: "MSO_THEME_COLOR", name: c.value } : c.value!.map(v => v.toString(16).padStart(2, "0")).join("") } });
  else operations.push({ operation: `model.dml.color.ColorFormat.${c.member}.get`, receiver: { resultHandle: "color" }, arguments: {}, ...(c.member === "rgb" && c.expected !== null ? { resultHandle: "rgb" } : {}) });
  if (!edits && c.member === "rgb" && c.expected !== null) operations.push({ operation: "model.shared.RGBColor.tuple_value_protocol.call", receiver: { resultHandle: "rgb" }, arguments: {} });
  const expectedRead = !edits && c.member === "rgb" && c.expected !== null ? [0, 2, 4].map(i => Number.parseInt(c.expected!.slice(i, i + 2), 16)) : c.expected;
  if (route === "model") { const document = await api.Document(input, textContext), color = document.paragraphs[0]!.runs[0]!.font.color; if (edits) Reflect.set(color, c.member, c.value === null ? null : typeof c.value === "string" ? { enum: "MSO_THEME_COLOR", name: c.value } : new api.RGBColor(...c.value!)); else { expect(c.member === "rgb" ? color.rgb?.toArray() ?? null : c.member === "type" ? color.type?.name ?? null : color.theme_color?.name ?? null).toEqual(expectedRead); } await document.save(sink); }
  else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); if (!edits) { const value = result.results.at(-1)!.value; expect(c.member === "rgb" ? value : (value as { name: string } | null)?.name ?? null).toEqual(expectedRead); } await result.save(sink); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --json${edits ? " --output /out" : ""}`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); if (edits) memory.writeFileSync("/out", await fs.readFile("/out")); else { const value = JSON.parse(result.stdout).data.results.at(-1).data; expect(c.member === "rgb" ? value : value?.name ?? null).toEqual(expectedRead); memory.writeFileSync("/out", input); } expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); for (const [name, bytes] of before) if (!edits || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const document = await api.Document(output, textContext), run = document.paragraphs[0]!.runs[0]!; expect(run.text).toBe("Original é 日本 עברית 🌊"); const xml = new api.DocumentXmlEditor(after.get("word/document.xml")!), node = xml.root.children[0]!.children[0]!.children[0]!, rPr = node.children.find(n => n.localName === "rPr"), color = rPr?.children.find(n => n.localName === "color");
  if (edits) { expect(color ? Object.fromEntries(color.attributes.filter(a => a.namespace === node.namespace).map(a => [a.localName, a.value])) : null).toEqual(c.after); expect(Boolean(rPr)).toBe(c.rPr || c.after !== null); }
  const text = new TextDecoder().decode(after.get("word/document.xml")); expect(text).toContain('w:rsidR="00ABCDEF"'); expect(text.split("<!--retain-->")).toHaveLength(2); expect(text.split("<?audit keep?>")).toHaveLength(2);
});
