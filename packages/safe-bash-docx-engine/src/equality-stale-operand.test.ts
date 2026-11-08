import { expect, it } from "vitest";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["ParagraphStyle", "CharacterStyle", "_TableStyle", "_NumberingStyle", "_LatentStyle", "Section"] as const)
it(`native live ${kind} equality rejects a removed same-document operand; strict=${strict}`, async () => {
  const type = { ParagraphStyle: "paragraph", CharacterStyle: "character", _TableStyle: "table", _NumberingStyle: "numbering", _LatentStyle: "paragraph", Section: "paragraph" }[kind];
  const styles = `<w:styles xmlns:w="${w}"><w:latentStyles><w:lsdException w:name="Removed"/><w:lsdException w:name="Live"/></w:latentStyles><w:style w:type="${type}" w:styleId="Removed"><w:name w:val="Removed"/></w:style><w:style w:type="${type}" w:styleId="Live"><w:name w:val="Live"/></w:style></w:styles>`;
  const document = await api.Document(await textFixture('<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Retained</w:t></w:r></w:p><w:p/><w:sectPr/>', { styles: { kind: "styles", xml: styles } }, strict), textContext);
  const collection = document.styles;
  const removed = kind === "Section" ? document.sections[0]! : kind === "_LatentStyle" ? collection.latent_styles.at("Removed") : collection.at("Removed");
  const live = kind === "Section" ? document.sections[1]! : kind === "_LatentStyle" ? collection.latent_styles.at("Live") : collection.at("Live");
  if (kind === "Section") removed.element.remove();
  else (removed as api.BaseStyle | api.LatentStyle).delete();
  expect(() => live.equals(removed)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});

for (const strict of [false, true])
it(`native recreated latent collection rejects its removed predecessor operand; strict=${strict}`, async () => {
  const document = await api.Document(await textFixture('<w:p/>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:latentStyles/></w:styles>` } }, strict), textContext);
  const removed = document.styles.latent_styles;
  removed.element.remove();
  const live = document.styles.latent_styles;
  expect(() => live.equals(removed)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});
