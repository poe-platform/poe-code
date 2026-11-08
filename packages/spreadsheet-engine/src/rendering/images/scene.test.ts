import { expect, it } from "vitest";
import { graphBackground } from "./scene.js";
import type { ChartNode, ObjectStyle } from "../../objects/index.js";
const style: ObjectStyle = {
  type: "GogStyle", line: { dash: "none", "auto-dash": "0" },
  fill: { attributes: { type: "pattern", "auto-type": "0", "is-auto": "0" },
    pattern: { type: "solid", back: "12:34:56:FF", fore: "0:0:0:FF", "auto-pattern": "0" } }
};
function graph(paint: ObjectStyle = style): ChartNode {
  return { type: "GogGraph", role: "", properties: [{
    name: "property", namespace: "", text: "", attributes: { name: "style", type: "GogStyle" },
    qualifiedAttributes: [], children: []
  }], data: [], children: [], style: paint };
}
it("resolves native captured explicit opaque solid background without mutating graph metadata", () => {
  const input = graph(), original = structuredClone(input);
  expect(graphBackground(input)).toBe("#123456");
  expect(input).toEqual(original);
});
it("resolves explicit fill none to no paint, keeping its metadata intact", () => {
  const input = graph({ ...style, fill: { attributes: { type: "none", "auto-type": "0" } } }), original = structuredClone(input);
  expect(graphBackground(input)).toBeUndefined();
  expect(input).toEqual(original);
});
it("preserves the captured truly empty graph default without inventing theme paint", () => {
  expect(graphBackground(undefined)).toBeUndefined();
  expect(graphBackground({ type: "GogGraph", role: "", properties: [], data: [], children: [] })).toBeUndefined();
});
it.each(["12:34:56", "12:34:56:FE", "GG:34:56:FF", "123:34:56:FF", "12::56:FF", "12:34:56:FF:00"])("rejects unsupported color %s while preserving serialized metadata", back => {
  const input = graph({ ...style, fill: { ...style.fill!, pattern: { ...style.fill!.pattern!, back } } }), original = structuredClone(input);
  expect(() => graphBackground(input)).toThrow("Unsupported ssconvert feature: graph scene rendering");
  expect(input).toEqual(original);
});
it.each([
  { ...style, line: { dash: "solid", "auto-dash": "0" } },
  { ...style, line: { dash: "none", "auto-dash": "1" } },
  { ...style, outline: { color: "0:0:0:FF" } },
  { ...style, fill: { ...style.fill!, attributes: { ...style.fill!.attributes, "auto-type": "1" } } },
  { ...style, fill: { ...style.fill!, attributes: { ...style.fill!.attributes, "is-auto": "1" } } },
  { ...style, fill: { ...style.fill!, gradient: { type: "linear" } } },
  { ...style, fill: { ...style.fill!, image: { name: "embedded" } } }
] satisfies ObjectStyle[])("rejects unimplemented theme/style paint rather than silently dropping it: %j", paint => {
  const input = graph(paint), original = structuredClone(input);
  expect(() => graphBackground(input)).toThrow("Unsupported ssconvert feature: graph scene rendering");
  expect(input).toEqual(original);
});
it("rejects extra root properties while preserving unknown property namespaces and content", () => {
  const input: ChartNode = { ...graph(), properties: [...graph().properties, {
    name: "property", namespace: "urn:original:extension", text: "preserve me", attributes: { name: "unknown" },
    qualifiedAttributes: [{ name: "custom", namespace: "urn:original:extension", value: "data" }], children: []
  }] }, original = structuredClone(input);
  expect(() => graphBackground(input)).toThrow("Unsupported ssconvert feature: graph scene rendering");
  expect(input).toEqual(original);
});
it("does not treat a plot child as background-only rendering", () => {
  expect(() => graphBackground({ ...graph(), children: [{ type: "GogChart", role: "Chart", properties: [], children: [], data: [] }] }))
    .toThrow("Unsupported ssconvert feature: graph scene rendering");
});

it.each([
  { ...style, font: { font: "Sans 10" } },
  { ...style, marker: { shape: "circle" } },
  { ...style, textLayout: { angle: "45" } }
] satisfies ObjectStyle[])("preserves unused root style metadata without rejecting its rectangle paint: %j", paint => {
  const input = graph(paint), original = structuredClone(input);
  expect(graphBackground(input)).toBe("#123456");
  expect(input).toEqual(original);
  expect(() => graphBackground({ ...input, children: [{ type: "GogChart", role: "Chart", properties: [], children: [], data: [] }] }))
    .toThrow("Unsupported ssconvert feature: graph scene rendering");
});
