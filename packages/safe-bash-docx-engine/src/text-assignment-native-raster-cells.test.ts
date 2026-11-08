import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const picture of [false, true]) for (const nested of [false, true])
for (const empty of [false, true]) for (const path of ["model", "direct"] as const)
it.concurrent(`cell text raster dependency removes selected content while retaining cell and outside ownership; ${dialect}; ${kind}; empty=${empty}; picture=${picture}; nested=${nested}; ${path}`, async () => {
  const base = await fixture(dialect, kind, variants[0]!), memory = Volume.fromJSON({ "/input": "", "/output": "", "/destination": "Retained destination" });
  const sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const authored = await api.Document(base, textContext);
  const section = authored.sections[0]!; section.page_width = api.Inches(8); section.left_margin = api.Inches(1); section.right_margin = api.Inches(1);
  const table = authored.add_table(1, 1), cell = table.cell(0, 0), p = cell.paragraphs[0]!;
  p.alignment = api.WD_ALIGN_PARAGRAPH.RIGHT; p.paragraph_format.keep_with_next = true;
  const run = p.add_run("Cell native 日本 עברית 🌊"); run.bold = true; run.font.rtl = true; if (picture) await run.add_picture(rasterPng());
  if (nested) cell.add_table(1, 1);
  const width = cell.width!.emu;
  await authored.save(sink("/input"));
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input), value = empty ? "" : "Replacement cell 🌊 日本 עברית";
  if (path === "model") { const doc = await api.Document(input, textContext); doc.tables[0]!.cell(0, 0).text = value; await doc.save(sink("/output")); }
  else await api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: value, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink("/output") });
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const reopened = await api.Document(output, textContext), changed = reopened.tables[0]!.cell(0, 0);
  expect(changed.text).toBe(value); expect(changed.width!.emu).toBe(width); expect(changed.paragraphs.length).toBe(1);
  expect(changed.paragraphs[0]!.runs.length).toBe(1); expect(changed.tables.length).toBe(0);
  expect(changed.paragraphs[0]!.alignment).toBe(null); expect(changed.paragraphs[0]!.paragraph_format.keep_with_next).toBe(null);
  for (const r of changed.paragraphs[0]!.runs) { expect(r.bold).toBe(null); expect(r.font.rtl).toBe(null); }
  expect((await api.inspectDocument(output, textContext)).counts.images).toBe(2);
  expect(reopened.paragraphs[0]!.text).toBe("Selected 日本 עברית 🌊"); expect(reopened.paragraphs[1]!.text).toBe("Unselected é海");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
});
