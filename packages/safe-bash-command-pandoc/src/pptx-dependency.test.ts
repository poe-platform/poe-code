import { expect, it } from "vitest";
import { createPresentation, Presentation, readPresentationText, Shape } from "pptx";

it("admits original presentation bytes through the public presentation engine", async () => {
  const model = await Presentation();
  const slide = model.slides.add_slide(model.slide_layouts.get(0));
  const { Inches } = await import("pptx");
  slide.shapes.add_textbox(new Inches(1), new Inches(1), new Inches(4), new Inches(1)).text = "Orchard survey";
  const bytes = await model.save();
  const reopened = await Presentation(bytes);
  expect(reopened.slides.length).toBe(1);
  const reopenedShape = reopened.slides.get(0).shapes.get(0);
  expect(reopenedShape).toBeInstanceOf(Shape);
  if (reopenedShape instanceof Shape) expect(reopenedShape.text).toBe("Orchard survey");
  expect(createPresentation).toBeTypeOf("function");
  expect(readPresentationText).toBeTypeOf("function");
});
