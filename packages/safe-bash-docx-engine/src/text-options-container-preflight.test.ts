import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) {
  for (const operation of ["replace", "dummy"] as const) {
    for (const value of [null, undefined]) {
      it(`rejects ${operation} options ${String(value)} as typed usage; strict=${strict}`, async () => {
        const input = await textFixture(paragraph("coast"), {}, strict);
        const volume = Volume.fromJSON({ "/output": "retained sink" });
        volume.writeFileSync("/input", input);
        const context = {
          ...textContext,
          encoding: { order: "input", compression: "store" } as const,
          stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } }
        };
        const error = await (operation === "replace"
          ? docx.replaceDocumentText(input, value as unknown as docx.TextReplaceOptions, context)
          : docx.setDocumentDummyText(input, value as unknown as docx.DummyTextOptions, context)
        ).catch((failure: unknown) => failure);
        expect(error).toMatchObject({ code: "usage" });
        expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
        expect(volume.readFileSync("/output", "utf8")).toBe("retained sink");
      });
    }
  }
}
