import { expect, it } from "vitest";
import { TextFrame } from "./text-frames.js";
import { TypeError } from "./errors.js";
import { admitFontMetrics } from "./font-metrics.js";
import { parseXmlPart } from "./xml.js";
import type { ModelTextFitOptions } from "./text-fitting.js";

const metrics = admitFontMetrics({
  family: "Calibri",
  bold: false,
  italic: false,
  unitsPerEm: 10,
  lineHeight: 10,
  advances: { A: 5 }
});
function frame() {
  return new TextFrame(
    parseXmlPart(
      new TextEncoder().encode(
        '<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody>'
      ),
      { maxBytes: 8192, maxNodes: 100, maxDepth: 16 }
    ),
    { width: 100, height: 100 }
  );
}

it.each([0, 1, 2, 3])(
  "rejects null positional argument %s without silently applying a default",
  (position) => {
    const model = frame(),
      before = model.xml;
    const args: unknown[] = [undefined, undefined, undefined, undefined, metrics];
    args[position] = null;
    expect(() => Reflect.apply(model.fit_text, model, args)).toThrow(TypeError);
    expect(() => Reflect.apply(model.fit_text, model, args)).toThrow(
      expect.objectContaining({ code: "invalid-type", phase: "usage" })
    );
    expect(model.xml).toBe(before);
  }
);

it("retains undefined positional defaults with explicit metrics and synchronous completion", () => {
  const model = frame();
  expect(model.fit_text(undefined, undefined, undefined, undefined, metrics)).toBeUndefined();
  const xml = model.xml.markup(model.xml.root);
  expect(xml).toContain('sz="1800"');
  expect(xml).toContain('b="0"');
  expect(xml).toContain('i="0"');
  expect(xml).toContain('typeface="Calibri"');
});

it("rejects option accessors without invoking them or publishing XML", () => {
  const model = frame(),
    before = model.xml;
  let reads = 0;
  const options = Object.defineProperty({}, "minSize", {
    enumerable: true,
    get() {
      reads++;
      return 1;
    }
  });
  expect(() =>
    model.fit_text(undefined, undefined, undefined, undefined, metrics, options)
  ).toThrow();
  expect(reads).toBe(0);
  expect(model.xml).toBe(before);
});

it.each([null, [], Object.create({ minSize: 1 })])(
  "rejects invalid option containers without mutation",
  (options) => {
    const model = frame(),
      before = model.xml;
    expect(() =>
      model.fit_text(
        undefined,
        undefined,
        undefined,
        undefined,
        metrics,
        options as ModelTextFitOptions
      )
    ).toThrow();
    expect(model.xml).toBe(before);
  }
);

it("rejects positional argument duplicates in trailing options", () => {
  const model = frame(),
    before = model.xml;
  expect(() =>
    model.fit_text(undefined, undefined, undefined, undefined, metrics, {
      fontFamily: "Hidden override"
    } as ModelTextFitOptions)
  ).toThrow();
  expect(model.xml).toBe(before);
});
