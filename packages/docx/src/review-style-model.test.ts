import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, ParagraphStyle } from "./styles-model.js";
import { inspectDocumentStyles } from "./styles.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";
async function source(styles: string): Promise<Uint8Array> {
  const bytes = await textFixture(paragraph("Lagoon survey"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${styles}</w:styles>` } });
  const volume = Volume.fromJSON({ "/source": Buffer.from(bytes) });
  return new Uint8Array(volume.readFileSync("/source") as Buffer);
}
it("uses the same direct universal indentation values for live and inherited style inspection", async () => {
  const bytes = await source('<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:pPr><w:ind w:left="240"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Detail"><w:name w:val="Detail"/><w:basedOn w:val="Base"/><w:pPr><w:ind w:left="-06.3pt"/></w:pPr></w:style>');
  const model = await openDocumentStyleModel(bytes, textContext);
  expect((model.styles.at("Detail") as ParagraphStyle).paragraph_format.left_indent?.pt).toBe(-6.3);
  const inspected = await inspectDocumentStyles(bytes, { name: "Detail" }, textContext);
  expect(inspected.styles[0]?.direct.leftIndent).toBe(-6.3);
  expect(inspected.styles[0]?.effective?.leftIndent).toBe(-6.3);
});
it("rejects unknown style type tokens rather than converting them to paragraph styles", async () => {
  const bytes = await source('<w:style w:type="unknown" w:styleId="Detail"><w:name w:val="Detail"/></w:style>');
  await expect((async () => { const model = await openDocumentStyleModel(bytes, textContext); return model.styles.at("Detail").type; })()).rejects.toThrow();
});
it.each(['w:defUIPriority="many"', 'w:defSemiHidden="perhaps"'])("rejects malformed latent-style defaults %s", async attributes => {
  const bytes = await source(`<w:latentStyles ${attributes}/>`);
  await expect((async () => { const model = await openDocumentStyleModel(bytes, textContext); return [model.styles.latent_styles.default_priority, model.styles.latent_styles.default_to_hidden]; })()).rejects.toThrow();
});

it.each(['<w:uiPriority w:val="many"/>', '<w:semiHidden w:val="perhaps"/>'])("rejects malformed concrete style metadata %s", async markup => {
  const bytes = await source(`<w:style w:type="paragraph" w:styleId="Detail"><w:name w:val="Detail"/>${markup}</w:style>`);
  const model = await openDocumentStyleModel(bytes, textContext);
  expect(() => [model.styles.at("Detail").priority, model.styles.at("Detail").hidden]).toThrow();
});
