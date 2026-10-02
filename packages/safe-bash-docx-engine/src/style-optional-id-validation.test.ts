import { expect, it } from "vitest";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";

const cases = [
  {name: "multiple anonymous native definitions", xml: '<w:style/><w:style/><w:style w:type="character"/><w:style w:type="table"/><w:style w:type="numbering"/>', code: null},
  {name: "anonymous incompatible base", xml: '<w:style><w:basedOn w:val="target"/></w:style><w:style w:type="character" w:styleId="target"/>', code: "style-base-type"},
  {name: "anonymous duplicate paragraph defaults", xml: '<w:style w:default="1"/><w:style w:default="1"/>', code: "style-default"},
  {name: "duplicate named definitions", xml: '<w:style w:styleId="same"/><w:style w:styleId="same"/>', code: "style-id"},
  {name: "named inheritance cycle", xml: '<w:style w:styleId="a"><w:basedOn w:val="b"/></w:style><w:style w:styleId="b"><w:basedOn w:val="a"/></w:style>', code: "style-cycle"},
] as const;
for (const strict of [false, true]) for (const c of cases)
it(`validates ${c.name} independently of optional native style IDs; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original 日本 עברית</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}">${c.xml}</w:styles>`}}, strict);
  const archive = await api.readArchive(input, textContext), report = api.validateDocumentArchive(archive);
  if (c.code === null) {expect(report.valid, JSON.stringify(report.diagnostics)).toBe(true); expect(report.diagnostics).toEqual([]);}
  else {expect(report.valid).toBe(false); expect(report.diagnostics).toContainEqual(expect.objectContaining({code: c.code}));}
});
