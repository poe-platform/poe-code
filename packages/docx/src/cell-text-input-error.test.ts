import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const [name, value] of [["null", null], ["undefined", undefined], ["number", 1], ["boolean", true], ["record", {}], ["array", []], ["symbol", Symbol("original")], ["bigint", 1n], ["function", () => { throw new Error("Caller callback must not execute."); }]] as const)
    it(`rejects nonstring cell text with the neutral input error: ${name}; ${kind}; strict=${strict}`, async () => {
      const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p></w:tc></w:tr></w:tbl><w:p/>');
      const doc = await api.Document(input, textContext), before = doc.part.blob, cell = doc.tables[0]!.cell(0, 0);
      let error: unknown;
      try { Reflect.set(cell, "text", value); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(api.InputTypeError);
      expect(error).toHaveProperty("code", "usage");
      expect(doc.part.blob).toEqual(before);
      expect(cell.text).toBe("Retain é 日本 עברית 🌊");
      expect(cell.paragraphs[0]!.runs[0]!.italic).toBe(true);
      expect(cell.paragraphs[0]!.runs[0]!.font.rtl).toBe(true);
      const memory = Volume.fromJSON({ "/out": "" });
      await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
      expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
    });
