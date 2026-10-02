import assert from "node:assert/strict";
import {test} from "node:test";
import {limitOptions as reference} from "../../toolcraft-design/dist/prompts/interactive/pagination.js";

test("prompt pagination preserves physical-row budgets, wrapping and cursor windows", async () => {
  const {limitOptions} = await import("toolcraft-design-rust/prompts/interactive/pagination");
  assert.equal(limitOptions.name, reference.name); assert.equal(limitOptions.length, reference.length);
  const options = Array.from({length: 12}, (_, index) => `${index}: ${index % 3 ? "long option with text" : "é👩‍👩‍👧‍👦\nsecond line"}`);
  for (const rows of [0, 1, 6, 10, 24, NaN]) for (const columns of [1, 9, 30]) for (const cursor of [-1, 0, 4, 11, 20, 2.5, NaN]) {
    function observe(fn) {const trace = []; const result = fn({cursor, options, output: {rows, columns}, maxItems: 6, style(value, active) {trace.push([value, active, this === undefined]); return `${active ? ">" : " "} ${value}`;}}); return {result, trace};}
    assert.deepEqual(observe(limitOptions), observe(reference));
  }
  for (const maxItems of [undefined, 0, -1, 2.5, NaN, Infinity]) for (const columnPadding of [0, 4, 0.5, NaN]) {
    const opts = {cursor: 6, options, output: {rows: 12, columns: 12}, maxItems, columnPadding, rowPadding: 2, style: value => value};
    assert.deepEqual(limitOptions(opts), reference(opts));
  }
});

test("prompt pagination preserves property order, array species and callback failures", async () => {
  const {limitOptions} = await import("toolcraft-design-rust/prompts/interactive/pagination");
  function observe(fn, fail, empty = false) {
    const trace = [], failure = {};
    class Options extends Array {static get [Symbol.species]() {trace.push("species"); return Options;}}
    const options = new Proxy(empty ? new Options() : new Options("first", "second\nextra", "third", "fourth", "fifth", "sixth"), {get(target, key, receiver) {trace.push(["options", key]); return Reflect.get(target, key, receiver);}});
    const output = new Proxy({columns: 8, rows: 7}, {get(target, key) {trace.push(["output", key]); return target[key];}});
    const opts = new Proxy({options, output, cursor: 3, maxItems: 6, columnPadding: 1, rowPadding: 2, style(value, active) {trace.push(["style", value, active, this === undefined]); if (fail) throw failure; return value;}}, {get(target, key) {trace.push(["opts", key]); return target[key];}});
    try {const result = fn(opts); return {values: [...result], species: result instanceof Options, trace};}
    catch (error) {assert.equal(error, failure); return {failed: true, trace};}
  }
  for (const fail of [false, true]) for (const empty of [false, true]) assert.deepEqual(observe(limitOptions, fail, empty), observe(reference, fail, empty));
});
