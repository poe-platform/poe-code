import { describe, expect, it } from "vitest";
import { Paragraph, Run, Font } from "./text-paragraphs.js";
import { parseXmlPart } from "./xml.js";
import { ColorFormat, RGBColor } from "./text-run-color.js";
import { Pt } from "./length.js";
const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
const parse = (body: string) =>
  parseXmlPart(new TextEncoder().encode(`<a:p xmlns:a="${ns}">${body}</a:p>`), {
    maxBytes: 10000,
    maxNodes: 100,
    maxDepth: 16
  });

describe("live paragraph public surface", () => {
  it("reads only regular runs and preserves the owning object", () => {
    let xml = parse(
      '<a:r><a:t>north &amp; east</a:t></a:r><a:br/><a:fld id="clock"><a:t>noon</a:t></a:fld>'
    );
    const parent = {};
    const p = new Paragraph(xml, {
      read: () => xml,
      write: (value) => {
        xml = value;
      },
      parent
    });
    expect(p.parent).toBe(parent);
    expect(p.text).toBe("north & east\vnoon");
    expect(p.runs).toHaveLength(1);
    const r = p.runs[0]!;
    expect(r).toBeInstanceOf(Run);
    expect(r.parent).toBe(p);
    const before = xml.bytes();
    expect(p.runs[0]).toBe(r);
    expect(xml.bytes()).toEqual(before);
    r.text = "west";
    expect(p.text).toBe("west\vnoon");
  });
  it("adds runs and breaks before end properties with live font edits", () => {
    const p = new Paragraph(parse('<a:endParaRPr lang="en-US"/>'));
    const r = p.add_run();
    r.text = "First";
    p.add_line_break();
    p.add_run().text = "Second";
    expect(p.text).toBe("First\vSecond");
    expect(p.xml.root.children.at(-1)?.name.localName).toBe("endParaRPr");
    expect(r.font).toBeInstanceOf(Font);
    r.font.bold = true;
    r.font.size = new Pt(14);
    expect(p.runs[0]!.font.bold).toBe(true);
    expect(p.runs[0]!.font.size?.pt).toBe(14);
    p.font.italic = true;
    expect(p.xml.markup(p.xml.root)).toContain("defRPr");
    expect(p.font.italic).toBe(true);
    expect(r.text).toBe("First");
  });
  it("clears content while preserving paragraph properties and invalidates old runs", () => {
    const p = new Paragraph(
      parse('<a:pPr lvl="2"/><a:r><a:rPr b="1"/><a:t>Old</a:t></a:r><a:br/><a:endParaRPr/>')
    );
    const old = p.runs[0]!;
    const font = old.font;
    expect(p.clear()).toBe(p);
    expect(p.level).toBe(2);
    expect(p.text).toBe("");
    expect(p.runs).toHaveLength(0);
    expect(p.xml.root.children.map((n) => n.name.localName)).toEqual(["pPr", "endParaRPr"]);
    p.add_run().text = "New";
    expect(() => old.text).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
    expect(() => {
      font.bold = false;
    }).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  });
  it("replaces text destructively, maps newlines to breaks and encodes controls", () => {
    const p = new Paragraph(parse('<a:pPr lvl="3"/><a:r><a:rPr b="1"/><a:t>Old</a:t></a:r>'));
    const old = p.runs[0]!;
    p.text = "A\nB\vC\u0001";
    expect(p.text).toBe("A\vB\vC_x0001_");
    expect(p.level).toBe(3);
    expect(p.runs.every((r) => r.font.bold === null)).toBe(true);
    expect(() => old.text).toThrow();
  });
  it("rejects invalid assignment before destructive changes", () => {
    const p = new Paragraph(parse("<a:r><a:t>Keep</a:t></a:r>"));
    const old = p.runs[0]!;
    expect(() => {
      p.text = 7 as unknown as string;
    }).toThrow();
    expect(old.text).toBe("Keep");
    expect(() => {
      old.text = null as unknown as string;
    }).toThrow();
    expect(old.text).toBe("Keep");
  });
});

it("converts font fill on color access and keeps returned color live", () => {
  const p = new Paragraph(parse("<a:r><a:rPr><a:gradFill/></a:rPr><a:t>Tint</a:t></a:r>"));
  const font = p.runs[0]!.font;
  const color = font.color;
  expect(color).toBeInstanceOf(ColorFormat);
  expect(p.xml.markup(p.xml.root)).not.toContain("gradFill");
  color.rgb = new RGBColor(12, 34, 56);
  expect(font.color).toBe(color);
  expect(font.color.rgb.toString()).toBe("0C2238");
  color.brightness = 0.25;
  expect(font.color.brightness).toBe(0.25);
  p.clear();
  expect(() => color.rgb).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
});
it("shares fill behavior with drawing owners without creating on inspection", () => {
  const p = new Paragraph(parse("<a:r><a:rPr/><a:t>Paint</a:t></a:r>"));
  const font = p.runs[0]!.font;
  const before = p.xml.bytes();
  expect(font.fill.type).toBeNull();
  expect(p.xml.bytes()).toEqual(before);
  font.fill.gradient();
  expect(font.fill.type).toBe(3);
  expect(font.fill.gradient_stops.length).toBe(2);
  font.color.rgb = new RGBColor(5, 10, 15);
  expect(font.fill.type).toBe(1);
  font.fill.background();
  expect(font.fill.type).toBe(5);
});
it("preserves paragraph extensions and default font across destructive edits", () => {
  const p = new Paragraph(
    parse(
      '<a:pPr><a:defRPr i="1"/></a:pPr><a:r><a:t>Remove</a:t></a:r><x:record xmlns:x="urn:example:annotation" value="retain"/>'
    )
  );
  const font = p.font;
  p.text = "Replacement";
  expect(font.italic).toBe(true);
  expect(p.xml.markup(p.xml.root)).toContain('value="retain"');
  expect(p.runs[0]!.font.italic).toBeNull();
  p.clear();
  expect(font.italic).toBe(true);
});
it("preserves text setter atomicity when the bounded XML limit is exceeded", () => {
  const p = new Paragraph(parse("<a:r><a:t>Keep</a:t></a:r>"));
  const run = p.runs[0]!;
  expect(() => {
    p.text = "x".repeat(12000);
  }).toThrowError(expect.objectContaining({ code: "resource-limit" }));
  expect(run.text).toBe("Keep");
});
it("keeps literal line separators inside a run and three-state formatting", () => {
  const p = new Paragraph(parse(""));
  const run = p.add_run();
  run.text = "A\nB\vC\tD\rE";
  expect(run.text).toBe("A\nB_x000B_C\tD\rE");
  expect(p.runs).toHaveLength(1);
  run.font.bold = false;
  expect(run.font.bold).toBe(false);
  run.font.bold = null;
  expect(run.font.bold).toBeNull();
  run.font.underline = true;
  expect(run.font.underline).toBe(true);
  run.font.underline = false;
  expect(run.font.underline).toBe(false);
  run.font.name = "Original Typeface";
  expect(run.font.name).toBe("Original Typeface");
  run.font.name = null;
  expect(run.font.name).toBeNull();
});
