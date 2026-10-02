import { expect, it } from "vitest";
import * as api from "./index.js";
it.each([
  "Chart",
  "SlidePlaceholder",
  "SlidePlaceholders",
  "SlideShapes",
  "Slide",
  "Slides",
  "Picture",
  "GraphicFrame",
  "GroupShape",
  "Adjustment",
  "AdjustmentCollection",
  "FreeformBuilder",
  "FreeformPath",
  "DrawingOperation",
  "insertPlaceholder"
])("exports public drawing member %s", (name) => {
  expect((api as Record<string, unknown>)[name]).toBeTypeOf("function");
});
