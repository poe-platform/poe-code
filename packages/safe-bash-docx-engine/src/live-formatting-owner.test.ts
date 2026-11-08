import { expect, it } from "vitest";
import { openDocumentStyleModel, WD_STYLE_TYPE } from "./styles-model.js";
import { textContext } from "../tests/fixtures/text.js";

it("invalidates retained formatting owner metadata and equality after style deletion", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Estuary notes", WD_STYLE_TYPE.PARAGRAPH);
  const font = style.font;
  const color = font.color;
  const format = style.paragraph_format;
  const tabs = format.tab_stops;
  const views = [font, color, format, tabs];
  for (const view of views) {
    expect(view.part).toBe(style.part);
    expect(view.equals(view)).toBe(true);
  }
  style.delete();
  for (const view of views) {
    expect(() => view.part).toThrow(RangeError);
    expect(() => view.equals(view)).toThrow(RangeError);
  }
  const replacement = model.styles.add_style("Estuary notes", WD_STYLE_TYPE.PARAGRAPH);
  expect(replacement.font.part).toBe(model.styles.part);
  expect(() => font.part).toThrow(RangeError);
});
