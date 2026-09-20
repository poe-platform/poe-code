import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { DocxUsageError } from "./argument-json.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

const invalidStrings = [undefined, null, false, 0, {}, [0]];

for (const strict of [false, true]) {
  for (const field of ["find", "with"] as const) {
    it(`rejects numeric array ${field} before publication; strict=${strict}`, async () => {
      const input = await textFixture(paragraph("coast"), {}, strict);
      const volume = Volume.fromJSON({ "/output": "retained sink" });
      volume.writeFileSync("/input", input);
      const options = { find: "coast", with: "shore", all: true, output: "-", [field]: [0] };
      const error = await docx.replaceDocumentText(input, options as unknown as docx.TextReplaceOptions, {
        ...textContext,
        encoding: { order: "input", compression: "store" },
        stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }
      }).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(DocxUsageError);
      expect(error).toMatchObject({ code: "usage" });
      expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
      expect(volume.readFileSync("/output", "utf8")).toBe("retained sink");
    });
    it.each(invalidStrings)(`rejects schema-invalid ${field}=%j before publication; strict=${strict}`, async value => {
      const input = await textFixture(paragraph("coast"), {}, strict);
      const volume = Volume.fromJSON({ "/output": "retained sink" });
      volume.writeFileSync("/input", input);
      const options = { find: "coast", with: "shore", all: true, output: "-", [field]: value };
      const error = await docx.replaceDocumentText(input, options as unknown as docx.TextReplaceOptions, {
        ...textContext,
        encoding: { order: "input", compression: "store" },
        stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }
      }).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(DocxUsageError);
      expect(error).toMatchObject({ code: "usage" });
      expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
      expect(volume.readFileSync("/output", "utf8")).toBe("retained sink");
    });
  }
}
