import { Volume } from "memfs";
import { expect, it } from "vitest";
import { TextFrame } from "./text-frames.js";
import { Paragraph } from "./text-paragraphs.js";
import { parseXmlPart } from "./xml.js";

const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
function frame() {
  const fs = Volume.fromJSON({
    "/frame.xml": `<a:txBody xmlns:a="${ns}"><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr lvl="2"/><a:r><a:rPr b="1"/><a:t>Oak</a:t></a:r></a:p><a:p><a:r><a:t>Elm</a:t></a:r></a:p></a:txBody>`
  });
  return new TextFrame(
    parseXmlPart(new Uint8Array(fs.readFileSync("/frame.xml") as Buffer), {
      maxBytes: 10000,
      maxNodes: 100,
      maxDepth: 20
    })
  );
}
it("returns immutable paragraph membership containing live owned handles", () => {
  const text = frame();
  const before = text.xml.bytes();
  const paragraphs = text.paragraphs;
  expect(paragraphs).toHaveLength(2);
  expect(Object.isFrozen(paragraphs)).toBe(true);
  expect(paragraphs[0]).toBeInstanceOf(Paragraph);
  expect(paragraphs[0]!.parent).toBe(text);
  expect(text.paragraphs[0]).toBe(paragraphs[0]);
  expect(text.xml.bytes()).toEqual(before);
  paragraphs[0]!.level = 4;
  expect(text.paragraphs[0]!.level).toBe(4);
  expect(text.xml.markup(text.xml.root)).toContain('lvl="4"');
  text.margin_left = text.margin_right;
  expect(paragraphs[0]!.level).toBe(4);
  const added = text.add_paragraph();
  expect(added).toBeInstanceOf(Paragraph);
  expect(added.parent).toBe(text);
  expect(text.paragraphs).toHaveLength(3);
  expect(paragraphs).toHaveLength(2);
  added.text = "Ash";
  expect(text.text).toBe("Oak\nElm\nAsh");
});
it("clear retains the first paragraph and its properties but invalidates removed handles", () => {
  const text = frame();
  const [first, removed] = text.paragraphs;
  expect(text.clear()).toBeUndefined();
  expect(text.text).toBe("");
  expect(text.word_wrap).toBe(true);
  expect(text.paragraphs).toHaveLength(1);
  expect(text.paragraphs[0]).toBe(first);
  expect(first!.level).toBe(2);
  expect(text.xml.markup(text.xml.root)).not.toContain('b="1"');
  expect(() => removed!.level).toThrow(expect.objectContaining({ code: "invalid-handle" }));
  expect(() => {
    removed!.level = 5;
  }).toThrow(expect.objectContaining({ code: "invalid-handle" }));
});
it("whole text assignment replaces paragraphs and does not revive old handles", () => {
  const text = frame();
  const [old] = text.paragraphs;
  text.text = "Birch\nFir";
  expect(text.paragraphs[0]).not.toBe(old);
  expect(text.paragraphs[0]!.level).toBe(0);
  expect(text.text).toBe("Birch\nFir");
  expect(() => old!.level).toThrow(expect.objectContaining({ code: "invalid-handle" }));
  const current = text.paragraphs[0]!;
  expect(() => {
    text.text = 7 as never;
  }).toThrow();
  expect(current.level).toBe(0);
});
it("keeps bound run edits visible through the frame and invalidates destructive descendants", () => {
  const text = frame();
  const first = text.paragraphs[0]!;
  const run = first.runs[0]!;
  run.text = "Maple";
  expect(text.text).toBe("Maple\nElm");
  run.font.italic = true;
  expect(first.runs[0]!.font.italic).toBe(true);
  const added = first.add_run();
  added.text = " grove";
  expect(text.text).toBe("Maple grove\nElm");
  text.clear();
  expect(() => run.text).toThrow(expect.objectContaining({ code: "invalid-handle" }));
  expect(() => {
    added.text = "stale";
  }).toThrow(expect.objectContaining({ code: "invalid-handle" }));
});
it("retains parser ceilings and publishes no partial child edit on failure", () => {
  const text = frame();
  const paragraph = text.paragraphs[0]!;
  const before = text.xml.bytes();
  expect(() => {
    paragraph.add_run().text = "x".repeat(11000);
  }).toThrow(expect.objectContaining({ code: "resource-limit" }));
  // Appending an empty run was a separate successful operation.
  expect(text.text).toBe("Oak\nElm");
  expect(text.xml.bytes().length).toBeGreaterThan(before.length);
  const current = text.xml.bytes();
  expect(() => {
    text.text = "x".repeat(11000);
  }).toThrow(expect.objectContaining({ code: "resource-limit" }));
  expect(text.xml.bytes()).toEqual(current);
  expect(paragraph.level).toBe(2);
});
