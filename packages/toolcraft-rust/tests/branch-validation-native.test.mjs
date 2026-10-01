import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDiscriminatedBranch as nativeDiscriminator } from "../dist/discriminator.js";
import { resolveDiscriminatedBranch as referenceDiscriminator } from "../../toolcraft/dist/discriminator.js";
import { validateUnionSchema as nativeUnion } from "../dist/union-validation.js";
import { validateUnionSchema as referenceUnion } from "../../toolcraft/dist/union-validation.js";
import { S } from "toolcraft-schema";

test("discriminator selection preserves diagnostics, own branches and raw branch values", () => {
  const schema = S.OneOf({ discriminator: "kind", branches: Object.fromEntries([
    ["good", S.Object({ field: S.String() })], ["__proto__", S.Object({})]
  ]) });
  for (const value of [undefined, null, true, 7, "bad", [], {}, new Date(),
    Object.create({ kind: "good" }), { kind: 3 }, { kind: null }, { kind: Symbol("kind") },
    { kind: "bad" }, { kind: "constructor" }, { kind: "__proto__" }, { kind: "good", field: "ready" }]) {
    const actualErrors = [], expectedErrors = [];
    assert.deepEqual(nativeDiscriminator(schema, value, "kind", "payload", actualErrors), referenceDiscriminator(schema, value, "kind", "payload", expectedErrors));
    assert.deepEqual(actualErrors, expectedErrors);
  }
});

test("discriminator reads preserve rest-property order and changing discriminator getters", () => {
  function run(resolve) {
    const log = [];
    let reads = 0;
    const symbol = Symbol.for("branch-extra");
    const value = { get kind() { log.push("kind"); return reads++ === 0 ? "good" : "discard"; },
      get field() { log.push("field"); return "ready"; }, [symbol]: 4 };
    const schema = { get branches() { log.push("branches"); return { good: S.Object({ field: S.String() }) }; } };
    const errors = [];
    const result = resolve(schema, value, "kind", "", errors);
    return { log, result, errors };
  }
  assert.deepEqual(run(nativeDiscriminator), run(referenceDiscriminator));
});

test("union validation selects exactly one normalized result and retains all failure messages", () => {
  const schema = S.Union([S.Object({ left: S.String() }), S.Object({ right: S.String() })]);
  for (const successful of [[], [0], [1], [0, 1]]) {
    for (const value of [undefined, [], null, new Date(), {}]) {
      function run(validate) {
        const errors = [], log = [];
        const result = validate(schema, value, "payload", errors, function(branch, branchErrors) {
          const index = schema.branches.indexOf(branch);
          log.push([index, this]);
          if (!successful.includes(index)) branchErrors.push({ path: "payload.field", message: "bad" }, { path: "ignored", message: "second" });
          return { normalized: index };
        });
        return { result, errors, log };
      }
      assert.deepEqual(run(nativeUnion), run(referenceUnion));
    }
  }
});

test("union iteration retains custom entries, index coercion and error getter order", () => {
  function run(validate) {
    const log = [];
    const index = { [Symbol.toPrimitive](hint) { log.push(["index", hint]); return "custom"; } };
    const branches = { entries() { log.push(["entries", this === branches]); return [[index, {}]]; } };
    const errors = [];
    validate({ branches }, {}, "", errors, (_branch, failures) => {
      failures.push({ get message() { log.push("message"); return "bad"; }, path: "field" });
    });
    return { errors, log };
  }
  assert.deepEqual(run(nativeUnion), run(referenceUnion));
});

test("branch callback exceptions retain identity and iterator-close precedence", () => {
  for (const validate of [nativeUnion, referenceUnion]) {
    for (const failure of [undefined, null, Symbol("failure"), { failure: true }]) {
      let closed = 0;
      const entries = { [Symbol.iterator]: () => ({
        next: () => ({ done: false, value: [0, {}] }),
        return() { closed++; throw new Error("cleanup"); }
      }) };
      assert.throws(() => validate({ branches: { entries: () => entries } }, {}, "", [], () => { throw failure; }), error => error === failure);
      assert.equal(closed, 1);
    }
  }
});

test("exhausted discriminator branches retain missing-versus-invalid diagnostics", () => {
  for (const value of [{}, { kind: "unknown" }]) {
    const actual = [], expected = [];
    assert.equal(nativeDiscriminator({ branches: {} }, value, "kind", "", actual), undefined);
    assert.equal(referenceDiscriminator({ branches: {} }, value, "kind", "", expected), undefined);
    assert.deepEqual(actual, expected);
    assert.match(actual[0].message, /No branches are available/);
  }
});

test("union callbacks reenter validation with independent error arrays", () => {
  for (const validate of [nativeUnion, referenceUnion]) {
    const schema = { branches: [{ outer: true }] };
    const value = {};
    const errors = [];
    const result = validate(schema, value, "outer", errors, (_branch, outerErrors) => {
      const innerErrors = [];
      const innerResult = validate({ branches: [{}] }, value, "inner", innerErrors, (_inner, failures) => {
        failures.push({ path: "inner", message: "rejected" });
      });
      assert.equal(innerResult, value);
      assert.equal(innerErrors.length, 2);
      assert.deepEqual(outerErrors, []);
      return { success: true };
    });
    assert.deepEqual(result, { success: true });
    assert.deepEqual(errors, []);
  }
});
