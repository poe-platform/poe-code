import assert from "node:assert/strict";
import { test } from "node:test";
import { convertJsonSchema as native } from "../dist/json-schema-converter.js";
import { convertJsonSchema as reference } from "../../toolcraft/dist/json-schema-converter.js";
import * as nativeSchema from "toolcraft-schema-rust";
import * as referenceSchema from "toolcraft-schema";

test("native conversion retains borrowed defaults and leaves frozen inputs intact", () => {
  for (const convert of [native, reference]) {
    const defaultValue = Object.freeze({ key: "default" });
    const schema = Object.freeze({ type: "object", properties: Object.freeze({ key: Object.freeze({ type: "string" }) }), additionalProperties: false, default: defaultValue });
    const converted = convert(schema);
    assert.equal(converted.default, defaultValue);
    assert.equal(Object.getOwnPropertyDescriptor(converted.shape, "key").enumerable, true);
    assert.deepEqual(Object.keys(schema), ["type", "properties", "additionalProperties", "default"]);
  }
});

test("independent schema engines retain pointer escaping, reference siblings and recursive validation", () => {
  for (const input of [
    { $ref: "#/$defs/a~1b~0c", $defs: { "a/b~c": { type: "string", minLength: 2 } } },
    { type: "object", properties: { next: { $ref: "#" }, value: { type: "number" } }, additionalProperties: false },
    { $ref: "#/$defs/object", $defs: { object: { type: "object", properties: { x: { type: "boolean" } }, required: ["x"] } }, properties: { y: { type: "string" } }, required: ["y"] }
  ]) {
    const left = native(input), right = reference(input);
    assert.deepEqual(nativeSchema.toJsonSchema(left), referenceSchema.toJsonSchema(right));
    for (const value of [null, "a", "ab", { next: { value: 2 } }, { next: { value: "bad" } }, { x: false, y: "yes" }, { x: false }])
      assert.deepEqual(nativeSchema.validate(left, value), referenceSchema.validate(right, value));
  }
});

test("prototype-named projected properties keep ordinary writable own descriptors", () => {
  const input = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"number"},"toString":{"type":"boolean"}},"additionalProperties":false}');
  for (const convert of [native, reference]) {
    const output = convert(input);
    assert.equal(Object.getPrototypeOf(output.shape), Object.prototype);
    for (const key of ["__proto__", "constructor", "toString"]) {
      const descriptor = Object.getOwnPropertyDescriptor(output.shape, key);
      assert.equal(descriptor.enumerable, true);
      assert.equal(descriptor.configurable, true);
      assert.equal(descriptor.writable, true);
      assert.equal(descriptor.value.kind, "optional");
    }
  }
});

test("composition discovery retains subclass iteration and iterator closing", () => {
  const run = (convert, second) => {
    const reads = [];
    class Branches extends Array {
      [Symbol.iterator]() {
        const iterator = super[Symbol.iterator]();
        return {
          next() { reads.push("next"); return iterator.next(); },
          return() { reads.push("close"); return { done: true }; }
        };
      }
    }
    const branch = tag => ({ type: "object", properties: { tag: { const: tag }, value: { type: "string" } }, required: ["tag"] });
    convert({ oneOf: new Branches(branch("a"), second ?? branch("b")) });
    return reads;
  };
  for (const second of [undefined,
    { type: "object", properties: { tag: { const: "b" } }, required: [] },
    { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] }
  ]) assert.deepEqual(run(native, second), run(reference, second));
});
