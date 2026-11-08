import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { filterSchemaForScope, getUnfilteredSchema } from "./schema-scope.js";

describe("filterSchemaForScope", () => {
  it("retains the original schema through repeated projections", () => {
    const schema = S.Object({ visible: S.String(), hidden: S.String({ scope: ["cli"] }) });
    const first = filterSchemaForScope(schema, "sdk")!;
    const second = filterSchemaForScope(first, "mcp")!;

    expect(getUnfilteredSchema(first)).toBe(schema);
    expect(getUnfilteredSchema(second)).toBe(schema);
    expect(getUnfilteredSchema(schema)).toBe(schema);
  });

  it("does not replace an inner schema's identity when promoting an optional field", () => {
    const inner = S.String({ requiredScopes: ["sdk"] });
    expect(filterSchemaForScope(S.Optional(inner), "sdk")).toBe(inner);
    expect(getUnfilteredSchema(inner)).toBe(inner);
  });

  it("preserves and recursively filters complex schema kinds", () => {
    const schema = S.Object({
      json: S.Json(),
      record: S.Record(S.String({ scope: ["sdk"] })),
      oneOf: S.OneOf({
        discriminator: "kind",
        branches: {
          first: S.Object({ visible: S.String(), hidden: S.String({ scope: ["cli"] }) })
        }
      }),
      union: S.Union([
        S.Object({ first: S.String(), hidden: S.String({ scope: ["cli"] }) }),
        S.Object({ second: S.Number() })
      ])
    });

    expect(filterSchemaForScope(schema, "sdk")).toEqual(
      S.Object({
        json: S.Json(),
        record: S.Record(S.String({ scope: ["sdk"] })),
        oneOf: S.OneOf({
          discriminator: "kind",
          branches: { first: S.Object({ visible: S.String() }) }
        }),
        union: S.Union([S.Object({ first: S.String() }), S.Object({ second: S.Number() })])
      })
    );
  });
});
