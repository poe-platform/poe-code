import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const maximum = Math.floor(Number.MAX_SAFE_INTEGER / 635);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const value of [maximum, -maximum, maximum + 1, -maximum - 1])
it(`stored section length has exact safe EMU boundary ${value}; ${kind}; strict=${strict}`, async () => {
  const {input} = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p/><w:sectPr><w:pgMar w:header="${value}"/></w:sectPr>`);
  const document = await api.Document(input, textContext);
  const batch = {version: 1, operations: [
    {operation: "model.document.Document.sections.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "sections"},
    {operation: "model.section.Section.header_distance.get", receiver: {resultHandle: "sections", index: 0}, arguments: {}}
  ]};
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/out": "", "/err": ""});
  if (Math.abs(value) <= maximum) {
    expect(document.sections[0]!.header_distance!.emu).toBe(value * 635);
    expect((await api.inspectDocumentSections(input, {}, textContext)).items[0]!.direct.headerDistance).toBe(value);
    expect((await api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: {order: "input", compression: "store"} })).results[1]!.data).toEqual({value: value * 635, unit: "emu"});
  } else {
    expect(() => document.sections[0]!.header_distance).toThrow(api.InvalidDocumentError);
    await expect(api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({code: "invalid-package"});
    await expect(api.inspectDocumentSections(input, {}, textContext)).rejects.toMatchObject({code: "invalid-package"});
    for (const args of [["batch", "/input", "--ops-json", JSON.stringify(batch), "--json"], ["sections", "list", "/input", "--json"]]) {
      volume.writeFileSync("/out", "");
      const result = await api.createDocxInspectionCommandEngine({limits: textContext.limits}).execute({
        args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
        filesystem: {async readFile(path) {return new Uint8Array(volume.readFileSync(path) as Buffer);}}, stdin: {async *[Symbol.asyncIterator]() {}},
        stdout: {async write(bytes) {volume.appendFileSync("/out", bytes);}}, stderr: {async write(bytes) {volume.appendFileSync("/err", bytes);}}
      });
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(volume.readFileSync("/out", "utf8") as string)).toMatchObject({ok: false, affected: 0, data: null, errors: [{code: "invalid-package"}]});
    }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
