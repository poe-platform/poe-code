import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const owners = [
  { member: "table_direction", family: "WD_TABLE_DIRECTION", name: "RTL" },
  { member: "alignment", family: "WD_TABLE_ALIGNMENT", name: "CENTER" },
  { member: "vertical_alignment", family: "WD_CELL_VERTICAL_ALIGNMENT", name: "BOTTOM" },
  { member: "height_rule", family: "WD_ROW_HEIGHT_RULE", name: "EXACTLY" }
] as const;
const body = '<w:tbl><w:tblPr><w:bidiVisual w:val="1"/><w:jc w:val="center"/></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="720" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:vAlign w:val="bottom"/></w:tcPr><w:p><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Outside</w:t></w:r></w:p>';
function target(doc: api.DocumentView, member: typeof owners[number]["member"]) {
  const table = doc.tables[0]!;
  return member === "vertical_alignment" ? table.cell(0, 0) : member === "height_rule" ? table.rows[0]! : table;
}
const boundaries = ["string", "number", "undefined", "array", "missing", "extra", "symbol", "prototype", "enum-getter", "name-getter", "wrong-family", "unknown-family", "unknown-name"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const { member, family, name } of owners) for (const boundary of boundaries)
    it(`rejects table ${member} ${boundary} without evaluating or changing bytes; ${kind}; strict=${strict}`, async () => {
      const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
      const doc = await api.Document(input, textContext), before = doc.part.blob;
      let getterCalls = 0;
      const token = { enum: family, name };
      const value: unknown = boundary === "string" ? name : boundary === "number" ? 1 : boundary === "undefined" ? undefined : boundary === "array" ? [token] : boundary === "missing" ? { enum: family } : boundary === "extra" ? { ...token, extra: true } : boundary === "symbol" ? { ...token, [Symbol("original")]: true } : boundary === "prototype" ? Object.assign(Object.create({ inherited: true }) as object, token) : boundary === "enum-getter" ? { get enum() { getterCalls++; return family; }, name } : boundary === "name-getter" ? { enum: family, get name() { getterCalls++; return name; } } : boundary === "wrong-family" ? api.WD_PARAGRAPH_ALIGNMENT.CENTER : boundary === "unknown-family" ? { enum: "ORIGINAL_UNKNOWN", name } : { enum: family, name: "ORIGINAL_UNKNOWN" };
      let error: unknown;
      try { Reflect.set(target(doc, member), member, value); } catch (caught) { error = caught; }
      expect(getterCalls).toBe(0);
      expect(error).toBeInstanceOf(boundary === "unknown-family" || boundary === "unknown-name" ? api.InvalidValueError : api.InputTypeError);
      expect(error).toHaveProperty("code", "usage");
      expect(doc.part.blob).toEqual(before);
      expect(doc.tables[0]!.cell(0, 0).text).toBe("é 日本 עברית 🌊");
      const memory = Volume.fromJSON({ "/out": "" });
      await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
      expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
    });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const { member, family, name } of owners) for (const representation of ["owned", "plain", "null-prototype", "null"] as const)
    it(`retains valid table ${member} ${representation} tokens and logical Unicode order; ${kind}; strict=${strict}`, async () => {
      const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
      const doc = await api.Document(input, textContext), owner = target(doc, member);
      const value = representation === "null" ? null : representation === "owned" ? api.enumMembers(family).find(value => value.name === name)! : representation === "plain" ? { enum: family, name } : Object.assign(Object.create(null) as object, { enum: family, name });
      const expected = representation === "null" ? member === "height_rule" ? { enum: family, name: "AT_LEAST" } : null : { enum: family, name };
      Reflect.set(owner, member, value);
      expect(Reflect.get(owner, member)).toEqual(expected);
      expect(doc.tables[0]!.cell(0, 0).text).toBe("é 日本 עברית 🌊");
      expect(doc.tables[0]!.cell(0, 0).paragraphs[0]!.runs[0]!.italic).toBe(true);
      expect(doc.tables[0]!.rows[0]!.height!.twips).toBe(720);
      const memory = Volume.fromJSON({ "/out": "" });
      await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
      const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [part, bytes] of before) if (part !== "word/document.xml") expect(after.get(part)).toEqual(bytes);
      const reopened = await api.Document(output, textContext);
      expect(Reflect.get(target(reopened, member), member)).toEqual(expected);
      expect(reopened.tables[0]!.cell(0, 0).text).toBe("é 日本 עברית 🌊");
      expect(reopened.paragraphs[0]!.text).toBe("Outside");
      expect((await api.validateDocument(output, textContext)).valid).toBe(true);
    });
