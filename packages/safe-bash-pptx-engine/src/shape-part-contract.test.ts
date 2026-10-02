import { expect, it } from "vitest";
import { Presentation, createPresentation, Inches, Shape } from "./index.js";
import { parseXmlPart } from "./xml.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};

it("retains the slide part on ordinary and grouped drawing handles", async () => {
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Anchorage" }] }, context),
    context
  );
  const slide = deck.slides[0]!;
  const shape = slide.shapes.add_textbox(
    new Inches(1),
    new Inches(1),
    new Inches(2),
    new Inches(1)
  );
  expect(shape.part).toBeDefined();
  expect(shape.part === slide.part).toBe(true);
  const preset = slide.shapes.add_shape(
    "RECTANGLE",
    new Inches(1),
    new Inches(1),
    new Inches(2),
    new Inches(1)
  );
  expect(preset.part === slide.part).toBe(true);
  const group = slide.shapes.add_group_shape([shape, preset]);
  expect(group.part === slide.part).toBe(true);
  const nested = group.shapes.get(0) as Shape;
  expect(nested.part === slide.part).toBe(true);
  nested.name = "Inner label";
  expect(new TextDecoder().decode(nested.part.blob)).toContain("Inner label");
  const detached = new Shape(parseXmlPart(shape.xml.bytes(), context.xmlLimits));
  expect(() => detached.part).toThrowError(
    expect.objectContaining({ code: "property-unavailable" })
  );
});
