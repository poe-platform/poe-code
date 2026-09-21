import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

async function document() {
  const volume = Volume.fromJSON({ "/input": Buffer.from(await textFixture(paragraph("Channel survey") + "<w:sectPr/>")) });
  return api.Document(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
}

it("retains live row and column protocols across append and rejects ordinal writes", async () => {
  const doc = await document();
  const table = doc.add_table(2, 2), rows = table.rows, columns = table.columns;
  rows[0]!.cells[0]!.text = "North";
  rows[1]!.cells[0]!.text = "South";
  const retained = rows.at(-1);
  table.add_row();
  table.add_column(api.Inches(1));
  expect(rows.length).toBe(3);
  expect(columns.length).toBe(3);
  expect(rows[1]).toBe(retained);
  expect([...rows].map(row => row.cells[0]!.text)).toEqual(["North", "South", ""]);
  expect([...columns].map(column => column.cells.length)).toEqual([3, 3, 3]);
  expect(rows.slice(-2, -1)[0]).toBe(retained);
  expect(rows.slice(-100, 100)).toHaveLength(3);
  expect(rows.slice(2, 1)).toEqual([]);
  expect(rows.slice(undefined, -1)).toHaveLength(2);
  expect(Reflect.get(columns, "slice")).toBeUndefined();
  for (const sequence of [rows, columns]) {
    expect(sequence.table).toBe(table);
    expect(sequence.part).toBe(table.part);
    expect(sequence.at(-3)).toBe(sequence.at(0));
    for (const index of [-4, 3]) expect(() => sequence.at(index)).toThrow(api.BoundsError);
    for (const index of [null, false, "0", NaN, Infinity, 0.5]) expect(() => sequence.at(index as number)).toThrow(api.InputTypeError);
    expect(() => Reflect.set(sequence, "0", retained)).toThrow(api.InputTypeError);
    expect(() => Reflect.deleteProperty(sequence, "0")).toThrow(api.InputTypeError);
    expect(() => Object.defineProperty(sequence, "0", { value: retained })).toThrow(api.InputTypeError);
  }
  for (const bound of [null, false, "0", NaN, Infinity, 0.5]) expect(() => rows.slice(bound as number)).toThrow(api.InputTypeError);
});

it("implements section slice and inherited sequence searches over live owners", async () => {
  const doc = await document();
  doc.add_section(); doc.add_section();
  const sections = doc.sections, last = sections.at(-1);
  expect(sections.length).toBe(3);
  expect(sections[-1]!.equals(last)).toBe(true);
  expect(sections.slice(-2, -1)[0]!.equals(sections.at(1))).toBe(true);
  expect(sections.slice(-100, 100)).toHaveLength(3);
  expect(sections.slice(2, 1)).toEqual([]);
  expect(sections.count(last)).toBe(1);
  expect(sections.includes(last)).toBe(true);
  expect(sections.index(last, -2, 100)).toBe(2);
  expect(() => sections.index(last, 0, -1)).toThrow(api.InvalidValueError);
  expect(sections.reversed().next().value.equals(last)).toBe(true);
  expect([...sections.reversed()]).toHaveLength(3);
  const foreign = (await document()).sections.at(0);
  expect(sections.count(foreign)).toBe(0);
  expect(sections.includes(foreign)).toBe(false);
  expect(() => sections.index(foreign)).toThrow(api.InvalidValueError);
  for (const index of [-4, 3]) expect(() => sections.at(index)).toThrow(api.BoundsError);
  for (const bound of [null, false, "0", NaN, Infinity, 0.5]) {
    expect(() => sections.at(bound as number)).toThrow(api.InputTypeError);
    expect(() => sections.slice(bound as number)).toThrow(api.InputTypeError);
    expect(() => sections.index(last, bound as number)).toThrow(api.InputTypeError);
  }
});

it("keeps sparse comment IDs keyed while creation fills the first unused ID", async () => {
  const doc = await document(), comments = doc.comments;
  const zero = comments.add_comment("Low water", "Observer", null);
  const far = comments.add_comment("High water");
  far.element.set_attribute({ namespaceURI: far.element.namespace, localName: "id" }, "99");
  expect(comments.length).toBe(2);
  expect(comments.get(0)!.equals(zero)).toBe(true);
  expect(comments.get(99)!.equals(far)).toBe(true);
  expect(comments.get(1)).toBeNull();
  expect(zero.initials).toBeNull();
  expect(far.initials).toBe("");
  expect([...comments].map(comment => comment.comment_id)).toEqual([0, 99]);
  expect(comments.add_comment().comment_id).toBe(1);
  for (const key of [-1, null, false, "0", NaN, Infinity, 0.5]) expect(() => comments.get(key as number)).toThrow(api.InputTypeError);
  expect(Reflect.get(comments, "at")).toBeUndefined();
  expect(Reflect.get(comments, "slice")).toBeUndefined();
  expect(Reflect.get(comments, "paragraphs")).toBeUndefined();
});

