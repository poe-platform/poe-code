import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAppliedDefault as native } from "../dist/applied-default.js";
import { validateAppliedDefault as reference } from "../../toolcraft/dist/applied-default.js";
import { filterSchemaForScope as nativeFilter } from "../dist/schema-scope.js";
import { filterSchemaForScope as referenceFilter } from "../../toolcraft/dist/schema-scope.js";
import { S } from "toolcraft-schema";

test("applied defaults preserve clone identity, invalid values and first diagnostics", () => {
  for (const schema of [S.String(), { ...S.String(), default: 7 },
    { ...S.Array(S.String()), default: ["ready", 3] },
    { ...S.Object({ field: S.String() }), default: { field: "ready" } }]) {
    const actualErrors = [], expectedErrors = [];
    const actual = native(schema, "field", actualErrors);
    const expected = reference(schema, "field", expectedErrors);
    assert.deepEqual(actual, expected);
    assert.deepEqual(actualErrors, expectedErrors);
    if (actual !== null && typeof actual === "object") assert.notEqual(actual, schema.default);
  }
});

test("scope-filtered defaults validate against original schemas and keep canonical hidden fields", () => {
  for (const [validate, filter] of [[native, nativeFilter], [reference, referenceFilter]]) {
    const schema = S.Object({ visible: S.String(), hidden: S.String({ scope: ["cli"] }) }, {
      default: { visible: "ready", hidden: "canonical" }
    });
    const projected = filter(schema, "sdk");
    const errors = [];
    const result = validate(projected, "field", errors);
    assert.deepEqual(result, { visible: "ready", hidden: "canonical" });
    assert.deepEqual(errors, []);
    assert.notEqual(result, schema.default);
  }
});

test("default validation does not insert nested defaults", () => {
  const child = S.String({ default: "ready" });
  const schema = S.Object({ child: S.Optional(child) }, { default: {} });
  child.default = 7;
  for (const validate of [native, reference]) {
    const errors = [];
    assert.deepEqual(validate(schema, "field", errors), {});
    assert.deepEqual(errors, []);
  }
});

test("default getters are re-read and arbitrary exceptions survive diagnostics", () => {
  for (const validate of [native, reference]) {
    let reads = 0;
    const schema = { kind: "string", get default() { reads++; return reads === 1 ? "guard" : "actual"; } };
    assert.equal(validate(schema, "field", []), "actual");
    assert.equal(reads, 2);
    for (const failure of [undefined, null, Symbol("failure"), { failure: true }]) {
      assert.throws(() => validate({ get default() { throw failure; } }, "field", []), error => error === failure);
      const errors = [];
      errors.push = function() { assert.equal(this, errors); throw failure; };
      assert.throws(() => validate({ kind: "string", default: 7 }, "field", errors), error => error === failure);
    }
  }
});
