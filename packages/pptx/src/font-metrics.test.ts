import { expect, it } from "vitest";
import { Volume } from "memfs";
import { admitFontMetrics, measureText, bestFitText } from "./font-metrics.js";

const font = { family: "Harbor", bold: false, italic: false };
const data = () => ({
  ...font,
  unitsPerEm: 10,
  lineHeight: 10,
  advances: { A: 5, B: 10, C: 5, " ": 2, "?": 8, "😀": 10, "́": 0 }
});
const options = { ...font, fontSize: 10, width: 12 };

it("admits an original metric document from memory with independent ownership", () => {
  const fs = Volume.fromJSON({ "/metrics.json": JSON.stringify(data()) });
  const input = JSON.parse(fs.readFileSync("/metrics.json", "utf8") as string);
  const metrics = admitFontMetrics(input);
  input.advances.A = 99;
  input.family = "Changed";
  expect(Object.isFrozen(metrics)).toBe(true);
  expect(measureText(metrics, "AA", options)).toEqual({
    lines: [{ text: "AA", width: 10 }],
    height: 10,
    overflow: false,
    replacements: 0
  });
});

it("collapses whitespace and greedily selects whole word prefixes", () => {
  const metrics = admitFontMetrics(data());
  expect(measureText(metrics, " \tAA\r\nB\vC\u00a0", options)).toEqual({
    lines: [
      { text: "AA", width: 10 },
      { text: "B", width: 10 },
      { text: "C", width: 5 }
    ],
    height: 30,
    overflow: false,
    replacements: 0
  });
  expect(measureText(metrics, "A C B", options).lines).toEqual([
    { text: "A C", width: 12 },
    { text: "B", width: 10 }
  ]);
});

it.each([
  [49, false],
  [50, false],
  [51, true]
])("compares width inclusively at %s", (fontSize, overflow) => {
  expect(
    measureText(admitFontMetrics(data()), "B", { ...options, width: 50, fontSize }).overflow
  ).toBe(overflow);
});
it.each([
  [99, 5],
  [100, 6],
  [101, 6]
])("fits both lines within height %s", (height, expected) => {
  expect(
    bestFitText(
      admitFontMetrics({ ...data(), unitsPerEm: 3, lineHeight: 25, advances: { B: 33, " ": 1 } }),
      "B B",
      { ...font, width: 66, height, maxSize: 6 }
    )
  ).toBe(expected);
});
it("finds the largest size, maximum endpoint and no-fit result", () => {
  const metrics = admitFontMetrics(data());
  const fit = { ...font, width: 36, height: 100, maxSize: 42 };
  expect(bestFitText(metrics, "AA", fit)).toBe(36);
  expect(bestFitText(metrics, "AA", { ...fit, width: 100 })).toBe(42);
  expect(bestFitText(metrics, "BB", { ...fit, width: 1 })).toBeNull();
  expect(bestFitText(metrics, "", { ...fit, width: 0, height: 0 })).toBe(42);
  expect(measureText(metrics, "  \n", options).lines).toEqual([]);
});
it("uses scalar advances for supplementary and zero-width glyphs", () => {
  expect(measureText(admitFontMetrics(data()), "Á😀", { ...options, width: 15 }).lines).toEqual([
    { text: "Á😀", width: 15 }
  ]);
});
it("requires exact font identity and a genuinely admitted handle", () => {
  const metrics = admitFontMetrics(data());
  for (const mismatch of [{ family: "harbor" }, { bold: true }, { italic: true }]) {
    expect(() => measureText(metrics, "A", { ...options, ...mismatch })).toThrowError(
      expect.objectContaining({ code: "unsupported-edit" })
    );
  }
  expect(() => measureText({ ...metrics }, "A", options)).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
});
it("rejects missing glyphs or uses an explicitly admitted replacement", () => {
  const metrics = admitFontMetrics(data());
  expect(() => measureText(metrics, "Z", options)).toThrowError(
    expect.objectContaining({ code: "unsupported-edit" })
  );
  expect(measureText(metrics, "ZZ", { ...options, missingGlyph: "?" })).toEqual({
    lines: [{ text: "ZZ", width: 16 }],
    height: 10,
    overflow: true,
    replacements: 2
  });
  expect(() => measureText(metrics, "A", { ...options, missingGlyph: "Z" })).toThrow();
  expect(() => measureText(metrics, "\ud800", { ...options, missingGlyph: "?" })).toThrow();
});
it.each([
  { unitsPerEm: 0 },
  { lineHeight: NaN },
  { bold: 1 },
  { advances: { A: -1 } },
  { advances: { AA: 3 } },
  { advances: { "\ud800": 2 } },
  { unexpected: true }
])("rejects malformed metric fields %j", (patch) => {
  expect(() => admitFontMetrics({ ...data(), ...patch } as never)).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
});
it("rejects accessor tables without evaluating them", () => {
  let reads = 0;
  const advances = {
    get A() {
      reads++;
      return 5;
    }
  };
  expect(() => admitFontMetrics({ ...data(), advances })).toThrow();
  expect(reads).toBe(0);
});
it("bounds admission, text and cumulative search work", () => {
  expect(() => admitFontMetrics(data(), { maxGlyphs: 2 })).toThrowError(
    expect.objectContaining({ code: "resource-limit" })
  );
  const metrics = admitFontMetrics(data());
  expect(() => measureText(metrics, "AAAA", options, { maxTextLength: 3 })).toThrowError(
    expect.objectContaining({ code: "resource-limit" })
  );
  expect(() =>
    bestFitText(metrics, "A A A", { ...font, width: 100, height: 100, maxSize: 18 }, { maxWork: 8 })
  ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
  expect(() => measureText(metrics, "A", options, { maxWork: Infinity })).toThrow();
  expect(() => measureText(metrics, "A", { ...options, width: NaN })).toThrow();
  expect(() =>
    bestFitText(metrics, "A", { ...font, width: 10, height: 10, maxSize: 1.5 })
  ).toThrow();
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true]
])("resolves explicit style %s %s without synthesis", (bold, italic) => {
  const style = { ...font, bold, italic };
  expect(
    measureText(admitFontMetrics({ ...data(), ...style }), "A", { ...options, ...style }).lines
  ).toEqual([{ text: "A", width: 5 }]);
});
it("charges only the normalized interword replacement spaces", () => {
  const metrics = admitFontMetrics({ ...data(), advances: { A: 5, "?": 2 } });
  expect(
    measureText(metrics, " A  A\tA ", { ...options, width: 100, missingGlyph: "?" }).replacements
  ).toBe(2);
});
