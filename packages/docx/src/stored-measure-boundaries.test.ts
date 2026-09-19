import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const member of ["size", "indent", "tab"] as const)
for (const raw of ["\u00a012pt", "12pt\u00a0", "\u200312pt", "12\u2003"])
it(`rejects non-XML whitespace in stored ${member} ${JSON.stringify(raw)}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr>${member === "indent" ? `<w:ind w:left="${raw}"/>` : member === "tab" ? `<w:tabs><w:tab w:val="left" w:pos="${raw}"/></w:tabs>` : ""}</w:pPr><w:r><w:rPr>${member === "size" ? `<w:sz w:val="${raw}"/>` : ""}</w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`);
  const document = await api.Document(input, textContext), paragraph = document.paragraphs[0]!, before = document.part.blob;
  expect(() => member === "size" ? paragraph.runs[0]!.font.size : member === "indent" ? paragraph.paragraph_format.left_indent : paragraph.paragraph_format.tab_stops.at(0).position).toThrow(api.InvalidDocumentError);
  expect(document.part.blob).toEqual(before);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [raw, emu] of [["0.0005mm", 18], ["-0.0005mm", -18], ["0.00005mm", 2], ["-0.00005mm", -2], ["0.0001pt", 1], ["-0.0001pt", -1]] as const)
it(`retains sub-twip stored positions with half-away EMU rounding ${raw}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="${raw}"/></w:tabs><w:ind w:left="${raw}"/></w:pPr><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`);
  const document = await api.Document(input, textContext), paragraph = document.paragraphs[0]!;
  expect(paragraph.paragraph_format.left_indent?.emu).toBe(emu);
  expect(paragraph.paragraph_format.tab_stops.at(0).position.emu).toBe(emu);
  const volume = Volume.fromJSON({ "/out": "" });
  await document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`orders a moved stop by its rounded storage position beside a sub-twip stop; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="0.04pt"/><w:tab w:val="right" w:pos="72pt"/></w:tabs></w:pPr><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>');
  const document = await api.Document(input, textContext), tabs = document.paragraphs[0]!.paragraph_format.tab_stops, moving = tabs.at(1);
  moving.position = api.Pt(0.025);
  expect([...tabs].map(stop => stop.position.emu)).toEqual([508, 635]);
  expect(tabs.at(1).equals(moving)).toBe(true);
  expect(new TextDecoder().decode(document.part.blob)).toContain('w:pos="0.04pt"');
});
