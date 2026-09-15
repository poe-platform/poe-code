import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

class Payload {}

describe.each([
  { kind: "object", schema: S.Object({}, { additionalProperties: true }) },
  { kind: "record", schema: S.Record(S.String()) },
  { kind: "oneOf", schema: S.OneOf({ discriminator: "kind", branches: { named: S.Object({ label: S.String() }) } }) },
  { kind: "union", schema: S.Union([S.Object({ label: S.String() }, { additionalProperties: true })]) }
])("$kind non-plain diagnostics", ({ schema }) => {
  it.each([
    { name: "Date", create: () => new Date(0) },
    { name: "Map", create: () => new Map() },
    { name: "Set", create: () => new Set() },
    { name: "class", create: () => new Payload() },
    { name: "custom prototype", create: () => Object.create({ inherited: true }) }
  ])("explains the rejected $name value", ({ create }) => {
    const payload = Object.assign(create(), { kind: "named", label: "ready" });
    const result = validate(S.Object({ payload: schema }), { payload });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid non-plain input");
    expect(result.issues[0]).toMatchObject({ path: ["payload"], received: "non-plain object" });
    expect(result.issues[0].message).toContain("non-plain object");
  });
});
