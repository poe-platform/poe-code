import { expect, it } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { selectionQuerySchema } from "./selector-schema.js";

const validator = compileJsonSchema(selectionQuerySchema);

it.each([
  { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
  { kind: "slide", position: { coordinateSystem: "zero-based", value: 0 } },
  { kind: "object", owner: "/ppt/slides/meadow.xml", name: "7" },
  { kind: "object", owner: "/ppt/slides/meadow.xml", name: "heading", all: true },
  { kind: "part", scope: "shared", part: "/ppt/media/tile.png" },
  { token: "canonical-token-validated-against-input" },
  { kind: "slide", token: "canonical-token-validated-against-input" }
])("admits a structurally valid typed query %j", (query) => {
  expect(validator.validate(query).ok).toBe(true);
});

it.each([
  {},
  { kind: "object", name: "heading" },
  { kind: "object", owner: "", name: "heading" },
  { kind: "slide", position: { value: 1 } },
  { kind: "slide", position: { coordinateSystem: "one-based", value: 0 } },
  { kind: "slide", position: { coordinateSystem: "zero-based", value: -1 } },
  { kind: "slide", position: { coordinateSystem: "one-based", value: 1.5 } },
  { kind: "slide", position: { coordinateSystem: "one-based", value: 9007199254740992 } },
  { kind: "slide", position: { coordinateSystem: "one-based", value: 1, extra: true } },
  { kind: "slide", id: "400", name: "Meadow" },
  { kind: "slide", part: "/ppt/slides/meadow.xml" },
  { kind: "slide", scope: "masters" },
  { kind: "slide", scope: "unrecognized" },
  { kind: "slide", extra: true },
  { token: "token", scope: "slides" },
  { token: "token", all: false },
  { token: "token", owner: "/ppt/slides/meadow.xml" },
  { token: "token", position: { coordinateSystem: "one-based", value: 1 } }
])("rejects an invalid typed query before document admission %j", (query) => {
  expect(validator.validate(query).ok).toBe(false);
});
