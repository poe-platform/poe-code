import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

import * as api from "../index.js";
import { extractSchema } from "./extract-schema.js";

describe("extractSchema", () => {
  it("is re-exported from the package entrypoint", () => {
    expect(api.extractSchema).toBe(extractSchema);
  });

  it("returns undefined when the script has no exported schema const", async () => {
    await expect(
      extractSchema('export default async () => "ok";', "/tmp/no-schema.ajs")
    ).resolves.toBeUndefined();
  });

  it("returns the descriptor for a simple object schema", async () => {
    await expect(
      extractSchema(
        "export const schema = S.Object({ name: S.String(), retries: S.Number() });",
        "/tmp/simple.ajs"
      )
    ).resolves.toEqual(
      S.Object({
        name: S.String(),
        retries: S.Number()
      })
    );
  });

  it("returns the descriptor for nested optional enum array schemas", async () => {
    await expect(
      extractSchema(
        [
          "export const schema = S.Object({",
          '  mode: S.Enum(["fast", "safe"]),',
          "  tags: S.Optional(S.Array(S.String())),",
          "  retries: S.Array(S.Optional(S.Number()))",
          "});"
        ].join("\n"),
        "/tmp/nested.ajs"
      )
    ).resolves.toEqual(
      S.Object({
        mode: S.Enum(["fast", "safe"]),
        tags: S.Optional(S.Array(S.String())),
        retries: S.Array(S.Optional(S.Number()))
      })
    );
  });

  it("returns the awaited descriptor when the initializer produces a promise", async () => {
    await expect(
      extractSchema(
        "export const schema = Promise.resolve(S.Object({ name: S.String() }));",
        "/tmp/promise.ajs"
      )
    ).resolves.toEqual(
      S.Object({
        name: S.String()
      })
    );
  });

  it("does not evaluate unrelated top-level script code", async () => {
    await expect(
      extractSchema(
        [
          "const external = missingIdentifier;",
          "export const schema = S.Object({ name: S.String() });"
        ].join("\n"),
        "/tmp/top-level.ajs"
      )
    ).resolves.toEqual(
      S.Object({
        name: S.String()
      })
    );
  });

  it("explains when the initializer directly references an earlier outer const", async () => {
    await expect(
      extractSchema(
        "const external = S.String(); export const schema = external;",
        "/tmp/external.ajs"
      )
    ).rejects.toThrow(
      "Failed to evaluate schema initializer in /tmp/external.ajs: schema initializer is evaluated in isolation; outer const 'external' is not in scope. Inline the value or move it into the schema literal."
    );
  });

  it("explains when the schema initializer references an earlier outer const", async () => {
    await expect(
      extractSchema(
        [
          "const Inner = S.String();",
          "export const schema = S.Object({ a: Inner });"
        ].join("\n"),
        "/tmp/outer-const.ajs"
      )
    ).rejects.toThrow(
      "Failed to evaluate schema initializer in /tmp/outer-const.ajs: schema initializer is evaluated in isolation; outer const 'Inner' is not in scope. Inline the value or move it into the schema literal."
    );
  });

  it("keeps the original unbound identifier detail for schema initializer typos", async () => {
    await expect(
      extractSchema(
        "export const schema = S.Object({ a: Nopee });",
        "/tmp/schema-typo.ajs"
      )
    ).rejects.toThrow("Identifier 'Nopee' is not defined.");
  });

  it("evaluates schema identifiers supplied by the schema import", async () => {
    await expect(
      extractSchema(
        [
          'import { S } from "schema";',
          "export const schema = S.Object({ a: S.String() });"
        ].join("\n"),
        "/tmp/imported-schema.ajs"
      )
    ).resolves.toEqual(
      S.Object({
        a: S.String()
      })
    );
  });

  it("reports the first referenced earlier outer const when several are used", async () => {
    await expect(
      extractSchema(
        [
          "const First = S.String();",
          "const Second = S.Number();",
          "export const schema = S.Object({ a: First, b: Second });"
        ].join("\n"),
        "/tmp/multiple-outer-consts.ajs"
      )
    ).rejects.toThrow(
      "Failed to evaluate schema initializer in /tmp/multiple-outer-consts.ajs: schema initializer is evaluated in isolation; outer const 'First' is not in scope. Inline the value or move it into the schema literal."
    );
  });

  it("throws a clear error when the initializer depends on an agent import", async () => {
    await expect(
      extractSchema(
        'import { taskSchema } from "agent"; export const schema = taskSchema;',
        "/tmp/agent-import.ajs"
      )
    ).rejects.toThrow(
      /Failed to evaluate schema initializer in \/tmp\/agent-import\.ajs: schema initializer must be pure/
    );
  });

  it("rejects non-terminating initializers with a tight budget", async () => {
    await expect(
      extractSchema(
        "export const schema = ((loop) => loop(loop))((loop) => loop(loop));",
        "/tmp/infinite.ajs"
      )
    ).rejects.toThrow(/Sandbox budget exceeded/);
  });
});
