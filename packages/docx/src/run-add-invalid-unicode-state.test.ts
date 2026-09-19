import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const value of ["\u0000", "\ud800", "\udfff"])
  it(`rejects invalid Unicode styled run without materializing parts ${strict}/${value.charCodeAt(0)}`, async () => {
    const input = await textFixture(paragraph("Retain 日本 עברית é 🌊"), {}, strict);
    const original = readPackage(input), d = await api.Document(input, textContext), p = d.paragraphs[0]!, old = p.runs[0]!;
    expect(() => p.add_run(value, "Default Paragraph Font")).toThrowError(api.InvalidValueError);
    expect(p.text).toBe("Retain 日本 עברית é 🌊"); expect(old.text).toBe(p.text);
    const volume = Volume.fromJSON({"/out": ""});
    await d.save({async write(bytes) {volume.appendFileSync("/out", bytes);}});
    expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(original);
  });
