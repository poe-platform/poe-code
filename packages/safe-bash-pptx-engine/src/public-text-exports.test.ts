import { expect, it } from "vitest";
import * as api from "./index.js";
import { Font, Paragraph, Run } from "./text-paragraphs.js";
import { InvalidHandleError } from "./errors.js";
it("exports the actual live text types and invalidation error through the SDK", () => {
  expect(api.Paragraph).toBe(Paragraph);
  expect(api.Run).toBe(Run);
  expect(api.Font).toBe(Font);
  expect(api.InvalidHandleError).toBe(InvalidHandleError);
});
it("identifies invalidated model handles with a neutral typed error", () => {
  const error = new api.InvalidHandleError();
  expect(error).toBeInstanceOf(api.OfficeError);
  expect(error.name).toBe("InvalidHandleError");
  expect(error.code).toBe("invalid-handle");
});
it("constructs a live text model using the bounded public XML view", () => {
  const xml = api.parseXmlPart(
    new TextEncoder().encode(
      '<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/><a:p/></a:txBody>'
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  const frame = new api.TextFrame(xml);
  frame.paragraphs[0]!.add_run().text = "Coastal survey";
  expect(frame.text).toBe("Coastal survey");
});
