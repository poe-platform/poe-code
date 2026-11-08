import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const declarations = [
  { member: "alignment", family: "WD_TABLE_ALIGNMENT", values: { left: "LEFT", center: "CENTER", right: "RIGHT" } },
  { member: "vertical_alignment", family: "WD_CELL_VERTICAL_ALIGNMENT", values: { top: "TOP", center: "CENTER", bottom: "BOTTOM", both: "BOTH" } },
  { member: "height_rule", family: "WD_ROW_HEIGHT_RULE", values: { auto: "AUTO", atLeast: "AT_LEAST", exact: "EXACTLY" } }
] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const declaration of declarations) for (const stored of ["", "ORIGINAL_UNKNOWN", "absent", ...Object.keys(declaration.values)])
    it(`reads or rejects stored table ${declaration.member}=${JSON.stringify(stored)} without mutation; ${kind}; strict=${strict}`, async () => {
      const { member, family, values } = declaration;
      const property = stored === "absent" ? "" : member === "alignment" ? `<w:jc w:val="${stored}"/>` : member === "vertical_alignment" ? `<w:vAlign w:val="${stored}"/>` : `<w:trHeight w:val="720" w:hRule="${stored}"/>`;
      const body = `<w:tbl><w:tblPr>${member === "alignment" ? property : ""}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:trPr>${member === "height_rule" ? property : ""}</w:trPr><w:tc><w:tcPr>${member === "vertical_alignment" ? property : ""}</w:tcPr><w:p><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p></w:tc></w:tr></w:tbl><w:p/>`;
      const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
      const doc = await api.Document(input, textContext), before = doc.part.blob, table = doc.tables[0]!;
      const owner = member === "vertical_alignment" ? table.cell(0, 0) : member === "height_rule" ? table.rows[0]! : table;
      if (stored === "" || stored === "ORIGINAL_UNKNOWN") {
        let error: unknown;
        try { Reflect.get(owner, member); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(api.InvalidDocumentError);
        expect(error).toHaveProperty("code", "invalid-package");
      } else expect(Reflect.get(owner, member)).toEqual(stored === "absent" ? null : { enum: family, name: values[stored as keyof typeof values] });
      expect(doc.part.blob).toEqual(before);
      expect(table.cell(0, 0).text).toBe("é 日本 עברית 🌊");
      expect(table.cell(0, 0).paragraphs[0]!.runs[0]!.italic).toBe(true);
      expect(table.cell(0, 0).paragraphs[0]!.runs[0]!.font.rtl).toBe(true);
      const memory = Volume.fromJSON({ "/out": "" });
      await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
      expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
    });
