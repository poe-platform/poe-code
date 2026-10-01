import {expect, it} from "vitest";
import {parseXmlPart} from "./xml.js";
import {TextFrame} from "./text-frames.js";

it("edits strikeout and baseline through live fonts without losing sibling formatting", () => {
  const frame = new TextFrame(parseXmlPart(new TextEncoder().encode('<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>word</a:t></a:r></a:p></a:txBody>')));
  const font = frame.paragraphs[0]!.runs[0]!.font;
  font.strike = "single";
  font.baseline = 30;
  expect(font.bold).toBe(true);
  expect(font.strike).toBe("single");
  expect(font.baseline).toBe(30);
  expect(new TextDecoder().decode(frame.xml.bytes())).toContain('baseline="30000"');
  const saved = frame.xml.bytes();
  expect(() => {font.baseline = 101;}).toThrow();
  expect(frame.xml.bytes()).toEqual(saved);
  font.strike = null;
  font.baseline = null;
  expect(font.strike).toBeNull();
  expect(font.baseline).toBeNull();
  expect(frame.paragraphs[0]!.runs[0]!.text).toBe("word");
});
