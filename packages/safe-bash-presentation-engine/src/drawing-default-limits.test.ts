import { expect, it } from "vitest";
import { createShapeXml } from "./shapes.js";
import { createConnectorXml, MSO_CONNECTOR_TYPE } from "./connectors.js";
import { Length } from "./length.js";

it("creates shapes beyond the former default XML ceiling", () => {
  const text = "x".repeat(1000001);
  expect(createShapeXml("text-box", 1, { text, left: new Length(0), top: new Length(0), width: new Length(10), height: new Length(10) })).toContain(text);
});
it("creates connectors beyond the former default XML ceiling", () => {
  const name = "x".repeat(100001);
  expect(createConnectorXml(1, {
    kind: MSO_CONNECTOR_TYPE.STRAIGHT, name,
    beginX: new Length(10), beginY: new Length(20),
    endX: new Length(30), endY: new Length(40)
  })).toContain(name);
});

it("honors explicit shape and connector XML limits", () => {
  const shape = { text: "hello", left: new Length(0), top: new Length(0), width: new Length(10), height: new Length(10) };
  const connector = { kind: MSO_CONNECTOR_TYPE.STRAIGHT, beginX: new Length(0), beginY: new Length(0), endX: new Length(10), endY: new Length(10) };
  for (const limits of [{ maxBytes: 10 }, { maxNodes: 1 }, { maxDepth: 1 }]) {
    expect(() => createShapeXml("text-box", 1, shape, undefined, limits)).toThrow("XML resource limit exceeded");
    expect(() => createConnectorXml(1, connector, undefined, limits)).toThrow("XML resource limit exceeded");
  }
});
