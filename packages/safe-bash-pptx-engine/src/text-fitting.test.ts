import { expect, it } from "vitest";
import { Volume } from "memfs";
import { TextFrame, fitTextFrames } from "./index.js";
import { parseXmlPart } from "./xml.js";
import { admitFontMetrics } from "./font-metrics.js";

const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
const data = {
  family: "Calibri",
  bold: false,
  italic: false,
  unitsPerEm: 10,
  lineHeight: 10,
  advances: { A: 5, B: 10, " ": 2 }
};
const metrics = admitFontMetrics(data);
const frame = (content = '<a:r><a:rPr u="sng"/><a:t>AA AA</a:t></a:r>', width = 26, height = 40) =>
  new TextFrame(
    parseXmlPart(
      new TextEncoder().encode(
        `<a:txBody xmlns:a="${ns}"><a:bodyPr lIns="12700" rIns="12700" tIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:p>${content}</a:p></a:txBody>`
      ),
      { maxBytes: 8192, maxNodes: 100, maxDepth: 16 }
    ),
    { width, height }
  );

it("fits to independent extents and sets every run and paragraph end while retaining other formatting", () => {
  const f = frame(
    '<a:r><a:rPr u="sng"/><a:t>AA </a:t></a:r><a:fld id="stamp" type="slidenum"><a:t>AA</a:t></a:fld><a:br/>',
    26,
    60
  );
  const before = f.text;
  expect(f.fit_text(undefined, 40, false, false, metrics)).toBeUndefined();
  expect(f.text).toBe(before);
  const xml = new TextDecoder().decode(f.xml.bytes());
  expect(xml).toContain('u="sng"');
  expect(xml).toContain('wrap="square"');
  expect(xml).toContain("noAutofit");
  expect(xml).not.toContain("spAutoFit");
  const paragraph = f.xml.root.children.find((n) => n.name.localName === "p")!;
  for (const node of paragraph.children.filter((n) =>
    ["r", "fld", "br", "endParaRPr"].includes(n.name.localName)
  )) {
    const pr =
      node.name.localName === "endParaRPr"
        ? node
        : node.children.find((n) => n.name.localName === "rPr")!;
    expect(pr.attributes.find((a) => a.name.localName === "sz")?.value).toBe("2000");
    expect(pr.attributes.find((a) => a.name.localName === "b")?.value).toBe("0");
    expect(pr.children.find((n) => n.name.localName === "latin")?.attributes[0]?.value).toBe(
      "Calibri"
    );
  }
});
it("keeps empty text and applies maximum size without inventing runs", () => {
  const f = frame("", 20, 0);
  expect(f.fit_text(undefined, undefined, undefined, undefined, metrics)).toBeUndefined();
  expect(new TextDecoder().decode(f.xml.bytes())).toContain('sz="1800"');
  expect(f.text).toBe("");
  expect(f.xml.root.children[1]!.children.map((n) => n.name.localName)).toEqual([
    "pPr",
    "endParaRPr"
  ]);
});
it("uses explicit margins, wrapping, style and line spacing", () => {
  const f = frame(undefined, 30, 40);
  f.fit_text(undefined, 40, false, false, metrics, {
    marginLeft: 3,
    marginRight: 3,
    wrap: false,
    lineSpacing: 2
  });
  expect(new TextDecoder().decode(f.xml.bytes())).toContain('sz="1000"');
  expect(f.margin_left.pt).toBe(3);
  expect(f.word_wrap).toBe(false);
  expect(new TextDecoder().decode(f.xml.bytes())).toContain('val="200000"');
});
it("rejects absent fonts, missing metrics and impossible minimum size without mutation", () => {
  for (const [family, supplied, minSize] of [
    ["Calibri", undefined, 1],
    ["Absent", metrics, 1],
    ["Calibri", metrics, 13],
    ["Calibri", admitFontMetrics({ ...data, advances: { A: 5 } }), 1]
  ] as const) {
    const f = frame("<a:r><a:t>BBBB</a:t></a:r>");
    const before = f.xml.bytes();
    expect(() => f.fit_text(family, 18, false, false, supplied, { minSize })).toThrowError(
      expect.objectContaining({ code: "unsupported-edit" })
    );
    expect(f.xml.bytes()).toEqual(before);
  }
});

it("exposes package fitting and admits original metric JSON from memfs", () => {
  const fs = Volume.fromJSON({ "/metric.json": JSON.stringify(data) });
  const supplied = admitFontMetrics(JSON.parse(fs.readFileSync("/metric.json", "utf8") as string));
  const f = frame();
  f.fit_text(undefined, undefined, undefined, undefined, supplied);
  expect(new TextDecoder().decode(f.xml.bytes())).toContain('sz="1800"');
  expect(typeof fitTextFrames).toBe("function");
});
it.each(["r", "br", "fld"])(
  "formats %s and its paragraph end with supplied bold metrics even without body properties",
  (kind) => {
    const xml = parseXmlPart(
      new TextEncoder().encode(
        `<p:txBody xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${ns}"><a:p><a:${kind}/></a:p></p:txBody>`
      ),
      { maxBytes: 8192, maxNodes: 100, maxDepth: 16 }
    );
    const f = new TextFrame(xml, { width: 100, height: 100 });
    f.fit_text(
      "Harbor",
      6,
      true,
      false,
      admitFontMetrics({ ...data, family: "Harbor", bold: true })
    );
    const result = new TextDecoder().decode(f.xml.bytes());
    expect(result.split('sz="600"')).toHaveLength(3);
    expect(result.split('b="1"')).toHaveLength(3);
    expect(result.split('typeface="Harbor"')).toHaveLength(3);
    expect(f.auto_size).toBe(0);
    expect(f.word_wrap).toBe(true);
  }
);
it("fits retained spaces without collapsing their layout", () => {
  const f = frame("<a:r><a:t>A  B</a:t></a:r>", 21, 100);
  f.fit_text(undefined, 30, false, false, metrics, { wrap: false });
  expect(new TextDecoder().decode(f.xml.bytes())).toContain('sz="1000"');
  expect(f.text).toBe("A  B");
});
it("rejects sizes beyond the document font range before changing XML", () => {
  const f = frame("");
  const before = f.xml.bytes();
  expect(() => f.fit_text(undefined, 4001, false, false, metrics)).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
  expect(f.xml.bytes()).toEqual(before);
});
it("ignores foreign body properties while preserving them during fitting", () => {
  const original = frame().xml;
  const xml = original.spliceChildren(original.root, 0, 0, [
    '<bodyPr xmlns="urn:original:metadata" keep="yes"/>'
  ]);
  const f = new TextFrame(xml, { width: 26, height: 40 });
  f.fit_text(undefined, 40, false, false, metrics);
  const result = new TextDecoder().decode(f.xml.bytes());
  expect(result).toContain('sz="2000"');
  expect(result).toContain('<bodyPr xmlns="urn:original:metadata" keep="yes"/>');
});
