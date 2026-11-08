import { expect, it } from "vitest";
import { Shape, readShape } from "./shapes.js";
import { TextFrame } from "./text-frames.js";
import { parseXmlPart } from "./xml.js";

function shape(kind = "sp", content = "") {
  return new Shape(
    parseXmlPart(
      new TextEncoder().encode(
        `<p:${kind} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr/>${content}<p:extLst/></p:${kind}>`
      ),
      { maxBytes: 10000, maxNodes: 100, maxDepth: 16 }
    )
  );
}

it("retains one typed text frame owned by its shape across text assignment", () => {
  const owner = shape();
  const frame = owner.text_frame;
  expect(frame).toBeInstanceOf(TextFrame);
  expect(owner.text_frame).toBe(frame);
  expect(frame.parent).toBe(owner);
  owner.text = "Cedar\nBirch";
  expect(owner.text_frame).toBe(frame);
  expect(frame.text).toBe("Cedar\nBirch");
  frame.text = "Ash";
  expect(owner.text).toBe("Ash");
});

it("creates the missing body on model text access but inspection stays noncreating", () => {
  const owner = shape();
  const before = owner.xml.bytes();
  expect(owner.has_text_frame).toBe(true);
  expect(readShape(owner.element).shapeId).toBe(0);
  expect(owner.xml.bytes()).toEqual(before);
  expect(owner.text).toBe("");
  expect(owner.element.children.map((node) => node.name.localName)).toEqual([
    "spPr",
    "txBody",
    "extLst"
  ]);
});

it("does not advertise or create text frames on group containers", () => {
  const owner = shape("grpSp");
  const before = owner.xml.bytes();
  expect(owner.has_text_frame).toBe(false);
  expect(() => owner.text_frame).toThrow("This shape has no text frame.");
  expect(() => {
    owner.text = "Invalid";
  }).toThrow("This shape has no text frame.");
  expect(owner.xml.bytes()).toEqual(before);
});

it("whole-shape text assignment removes old paragraph formatting and invalidates its handles", () => {
  const owner = shape(
    "sp",
    '<p:txBody><a:bodyPr lIns="40000"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr b="1"/><a:t>Original</a:t></a:r></a:p></p:txBody>'
  );
  const frame = owner.text_frame;
  const previous = frame.paragraphs[0]!;
  owner.text = "New\nContent";
  expect(frame.text).toBe("New\nContent");
  expect(frame.margin_left.emu).toBe(40000);
  expect(frame.paragraphs).toHaveLength(2);
  expect(owner.xml.markup(owner.element)).not.toContain('algn="ctr"');
  expect(owner.xml.markup(owner.element)).not.toContain('b="1"');
  expect(() => previous.text).toThrow();
});
