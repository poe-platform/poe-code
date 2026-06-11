import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { filterSchemaForScope } from "./schema-scope.js";

describe("filterSchemaForScope", () => {
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
