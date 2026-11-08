import { expect, it } from "vitest";
import { openDocumentLocations, decodeLocation, encodeLocation } from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";

const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
function native(text: string, nested = ""): string {
  return `<w:r><w:drawing><wp:wsp xmlns:wp="${wp}"><wp:txbx><wp:txbxContent>${paragraph(text)}${nested}</wp:txbxContent></wp:txbx></wp:wsp></w:drawing></w:r>`;
}
for (const strict of [false, true]) it(`indexes native ${strict ? "Strict" : "Transitional"} bodies separately from their enclosing story`, async () => {
  const body = `<w:p>${native("boxed")}</w:p>`;
  const bytes = await textFixture(strict ? body.split(wp).join("http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing") : body, {}, strict);
  const document = await openDocumentLocations(bytes, textContext);
  expect(document.list("paragraph", { scope: "body" })).toHaveLength(1);
  expect(document.list("story", { scope: "text-boxes" })).toHaveLength(1);
  expect(document.list("paragraph", { scope: "text-boxes" })).toHaveLength(1);
  const shape = document.at("shape", 1);
  expect(shape.positions.shape).toBe(1);
  expect(document.resolve(shape.token, "shape")).toEqual(shape);
  expect(() => document.resolve(shape.token, "image")).toThrowError(expect.objectContaining({ code: "stale-selection" }));
  expect(() => document.resolve(encodeLocation({ ...decodeLocation(shape.token), generation: 1 }), "shape")).toThrowError(expect.objectContaining({ code: "stale-selection" }));
  expect(document.list("shape", { scope: "text-boxes" })).toHaveLength(0);
});
it("indexes nested shapes only inside their own containing text-box stories", async () => {
  const document = await openDocumentLocations(await textFixture(`<w:p>${native("outer", `<w:p>${native("inner")}</w:p>`)}</w:p>`), textContext);
  expect(document.list("shape", { scope: "body" })).toHaveLength(1);
  expect(document.list("shape", { scope: "text-boxes" })).toHaveLength(1);
  expect(document.list("story", { scope: "text-boxes" })).toHaveLength(2);
  const stories = document.list("story", { scope: "text-boxes" });
  expect(stories[0]!.value.path.length).toBeLessThan(stories[1]!.value.path.length);
  expect(new Set(stories.map(x => x.token)).size).toBe(2);
});
it("does not associate opaque multiple or wne bodies with editable shape stories", async () => {
  const s = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
  const ne = "http://schemas.microsoft.com/office/word/2006/wordml";
  for (const bodies of [`<w:txbxContent>${paragraph("one")}</w:txbxContent><w:txbxContent>${paragraph("two")}</w:txbxContent>`, `<n:txbxContent xmlns:n="${ne}">${paragraph("opaque")}</n:txbxContent>`]) {
    const document = await openDocumentLocations(await textFixture(`<w:p><w:r><w:drawing><s:wsp xmlns:s="${s}"><s:txbx>${bodies}</s:txbx></s:wsp></w:drawing></w:r></w:p>`), textContext);
    expect(document.list("shape")).toHaveLength(1);
    const shape = document.at("shape", 1);
    expect(document.list("story", { owner: shape.token })).toHaveLength(0);
    expect(() => document.shapeStory(shape.token)).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  }
});
it("refuses a shape text owner with no admitted body and a carrier lookup with a non-shape token", async () => {
  const document = await openDocumentLocations(await textFixture(`<w:p><w:r><w:drawing><wp:wsp xmlns:wp="${wp}"/></w:drawing></w:r></w:p>`), textContext);
  const shape = document.at("shape", 1);
  expect(() => document.shapeStory(shape.token)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
  expect(document.shapeCarrier(shape.token).representation).toBe("native");
  expect(() => document.shapeCarrier(document.at("paragraph", 1).token)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});
it("keeps unsupported MCE choices inactive when censusing shape locations", async () => {
  const fallback = native("fallback");
  const body = `<w:p><m:AlternateContent xmlns:m="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:unavailable"><m:Choice Requires="x">${native("inactive")}</m:Choice><m:Fallback>${fallback}</m:Fallback></m:AlternateContent></w:p>`;
  const document = await openDocumentLocations(await textFixture(body), textContext);
  expect(document.list("shape")).toHaveLength(1);
  expect(document.list("story", { scope: "text-boxes" })).toHaveLength(1);
});
it("resets shape ordinals within each story and refuses cross-story ordinal ambiguity", async () => {
  const body = `<w:p>${native("body")}</w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>`;
  const bytes = await textFixture(body, { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p>${native("header")}</w:p></w:hdr>` } });
  const document = await openDocumentLocations(bytes, textContext);
  const shapes = document.list("shape", { scope: "all-stories" });
  expect(shapes).toHaveLength(2); expect(shapes.map(x => x.positions.shape)).toEqual([1, 1]);
  expect(() => document.at("shape", 1, { scope: "all-stories" })).toThrowError(expect.objectContaining({ code: "ambiguous-selection" }));
  expect(document.at("shape", 1, { scope: "headers" }).value.part).toBe("/word/header.xml");
  expect(document.list("shape", { owner: document.at("paragraph", 1).token })).toHaveLength(1);
  expect(document.list("shape", { section: 1 })).toHaveLength(1);
  expect(() => document.list("shape", { owner: document.at("section", 1).token })).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(() => document.list("shape", { owner: document.list("part")[0]!.token })).toThrowError(expect.objectContaining({ code: "usage" }));
});
