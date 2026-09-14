import { expect, it } from "vitest";
import { Volume } from "memfs";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { inspectDocumentStyles } from "./styles.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
const root = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
const ref = (resultHandle: string) => ({ resultHandle });
const bootstrap = { operation: "model.document.Document.styles.get", arguments: {}, receiver: root, resultHandle: "styles" };
const add = { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: { name: "Harbor", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "harbor" };
it("executes typed live style, font and tab edits and publishes only to the supplied sink", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [bootstrap, add,
    { operation: "model.styles.style.ParagraphStyle.font.get", receiver: ref("harbor"), arguments: {}, resultHandle: "font" },
    { operation: "model.text.run.Font.all_caps.set", receiver: ref("font"), arguments: { value: true } },
    { operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: ref("harbor"), arguments: {}, resultHandle: "format" },
    { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "tabs" },
    { operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: ref("tabs"), arguments: { position: { value: 1, unit: "in" } }, resultHandle: "stop" },
    { operation: "model.text.tabstops.TabStop.position.get", receiver: ref("stop"), arguments: {} }
  ] }, textContext);
  expect(applied.affected).toBe(4);
  expect(applied.results.at(-1)).toMatchObject({ value: { value: 914400, unit: "emu" } });
  const volume = Volume.fromJSON({ "/result": "" });
  await applied.save({ async write(bytes: Uint8Array) { volume.appendFileSync("/result", bytes); } });
  expect((await inspectDocumentStyles(new Uint8Array(volume.readFileSync("/result") as Buffer), {}, textContext)).styles).toMatchObject([{ name: "Harbor", direct: { allCaps: true, tabStops: [{ position: 72 }] } }]);
});
it("rejects unowned literal receivers and unsupported methods before publication", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  await expect(applyStyleModelBatch(input, { version: 1, operations: [{ ...bootstrap, receiver: { ...root, owner: "elsewhere" } }] }, textContext)).rejects.toThrow();
  await expect(applyStyleModelBatch(input, { version: 1, operations: [{ operation: "model.document.Document.save.call", receiver: root, arguments: { sink: { path: "/outside", capability: "none" } } }] }, textContext)).rejects.toThrow();
});
it("edits latent defaults and entries through explicit named result handles", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [bootstrap,
    { operation: "model.styles.styles.Styles.latent_styles.get", receiver: ref("styles"), arguments: {}, resultHandle: "latent" },
    { operation: "model.styles.latent.LatentStyles.default_to_locked.set", receiver: ref("latent"), arguments: { value: true } },
    { operation: "model.styles.latent.LatentStyles.add_latent_style.call", receiver: ref("latent"), arguments: { name: "Harbor label" }, resultHandle: "entry" },
    { operation: "model.styles.latent._LatentStyle.priority.set", receiver: ref("entry"), arguments: { value: 12 } },
    { operation: "model.styles.latent._LatentStyle.priority.get", receiver: ref("entry"), arguments: {} }
  ] }, textContext);
  expect(applied.results.at(-1)).toMatchObject({ value: 12 });
});
it("resolves keyed collection handles and checks concrete subtype before inherited access", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const selected = await applyStyleModelBatch(input, { version: 1, operations: [bootstrap, add,
    { operation: "model.styles.style.ParagraphStyle.font.get", receiver: { resultHandle: "styles", key: "Harbor" }, arguments: {}, resultHandle: "font" },
    { operation: "model.text.run.Font.bold.set", receiver: ref("font"), arguments: { value: false } },
    { operation: "model.text.run.Font.bold.get", receiver: ref("font"), arguments: {} }
  ] }, textContext);
  expect(selected.results.at(-1)).toMatchObject({ value: false });
  await expect(applyStyleModelBatch(input, { version: 1, operations: [bootstrap, { ...add, arguments: { ...add.arguments, styleType: { enum: "WD_STYLE_TYPE", name: "CHARACTER" } } },
    { operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: ref("harbor"), arguments: {} }
  ] }, textContext)).rejects.toThrow("receiver");
});
it("edits RGB and theme colors and reads immutable color helpers", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [bootstrap, add,
    { operation: "model.styles.style.ParagraphStyle.font.get", receiver: ref("harbor"), arguments: {}, resultHandle: "font" },
    { operation: "model.text.run.Font.color.get", receiver: ref("font"), arguments: {}, resultHandle: "color" },
    { operation: "model.dml.color.ColorFormat.rgb.set", receiver: ref("color"), arguments: { value: "102030" } },
    { operation: "model.dml.color.ColorFormat.rgb.get", receiver: ref("color"), arguments: {}, resultHandle: "rgb" },
    { operation: "model.shared.RGBColor.__str__.call", receiver: ref("rgb"), arguments: {} },
    { operation: "model.dml.color.ColorFormat.theme_color.set", receiver: ref("color"), arguments: { value: { enum: "MSO_THEME_COLOR", name: "ACCENT_1" } } },
    { operation: "model.dml.color.ColorFormat.type.get", receiver: ref("color"), arguments: {} }
  ] }, textContext);
  expect(applied.results[6]).toMatchObject({ value: "102030" });
  expect(applied.results.at(-1)).toMatchObject({ value: { enum: "MSO_COLOR_TYPE", name: "THEME" } });
  expect(applied.publish).toBeTypeOf("function");
});
it("returns opaque inherited XML and part handles and compares live identity without exposing storage", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [bootstrap, add,
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Harbor" }, resultHandle: "same" },
    { operation: "model.styles.style.BaseStyle.__eq__.call", receiver: ref("harbor"), arguments: { other: ref("same") } },
    { operation: "model.styles.style.BaseStyle.element.get", receiver: ref("harbor"), arguments: {} },
    { operation: "model.styles.style.BaseStyle.part.get", receiver: ref("harbor"), arguments: {} }
  ] }, textContext);
  expect(applied.results[3]).toMatchObject({ value: true });
  expect(applied.results[4]).toMatchObject({ value: { type: "XmlElementView", owner: "document" } });
  expect(applied.results[5]).toMatchObject({ value: { type: "XmlPartView", owner: "document" } });
  expect(JSON.stringify(applied.results)).not.toContain("store");
});
it("executes checked length accessors and formatting enum conversions", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [
    { operation: "model.shared.Inches.call", arguments: { inches: 2 }, resultHandle: "length" },
    { operation: "model.shared.Inches.emu.get", receiver: ref("length"), arguments: {} },
    { operation: "model.enum.style.WD_STYLE_TYPE.PARAGRAPH.get", arguments: {}, resultHandle: "kind" },
    { operation: "model.enum.style.WD_STYLE_TYPE.value.get", receiver: ref("kind"), arguments: {} },
    { operation: "model.enum.text.WD_UNDERLINE.from_xml.call", arguments: { xmlValue: "single" }, resultHandle: "underline" },
    { operation: "model.enum.text.WD_UNDERLINE.xml_value.get", receiver: ref("underline"), arguments: {} }
  ] }, textContext);
  expect(applied.results[0]).toMatchObject({ value: { value: 1828800, unit: "emu" } });
  expect(applied.results[1]).toMatchObject({ value: 1828800 });
  expect(applied.results[3]).toMatchObject({ value: 1 });
  expect(applied.results[5]).toMatchObject({ value: "single" });
});
it("selects immutable enum members through named map handles", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [
    { operation: "model.enum.style.WD_STYLE_TYPE.members.get", arguments: {}, resultHandle: "kinds" },
    { operation: "model.enum.style.WD_STYLE_TYPE.name.get", receiver: { resultHandle: "kinds", key: "PARAGRAPH" }, arguments: {} }
  ] }, textContext);
  expect(applied.results[0]).toMatchObject({ value: expect.arrayContaining([{ key: "PARAGRAPH", value: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }]) });
  expect(applied.results[1]).toMatchObject({ value: "PARAGRAPH" });
});
it("rejects guessed nonroot literal handles even when their IDs collide with this batch", async () => {
  const input = await textFixture(paragraph("Harbor log"));
  await expect(applyStyleModelBatch(input, { version: 1, operations: [bootstrap,
    { operation: "model.styles.styles.Styles.__len__.get", arguments: {}, receiver: { id: "handle1", type: "Styles", owner: "document", revision: 0 } }
  ] }, textContext)).rejects.toThrow("named");
});
