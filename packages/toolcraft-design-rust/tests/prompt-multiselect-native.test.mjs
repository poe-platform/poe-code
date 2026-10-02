import assert from "node:assert/strict";
import {test} from "node:test";
import {PassThrough, Writable} from "node:stream";
import {Prompt as OriginalPrompt} from "../../toolcraft-design/dist/prompts/interactive/core.js";
import {multiselectPrompt as original} from "../../toolcraft-design/dist/prompts/interactive/multiselect.js";

test("multiselect preserves toggles, shortcuts, required validation, cancellation and frames", async () => {
  const {multiselectPrompt} = await import("toolcraft-design-rust/prompts/interactive/multiselect");
  const options = [{value: "a", label: "Alpha", hint: "first"}, {value: "b", label: "Beta", disabled: true}, {value: "c", label: "Gamma"}, {value: "d", label: "Delta"}, {value: "e", label: "Epsilon"}, {value: "f", label: "Zeta"}];
  async function observe(fn, initialValues, keys, required = false, tty = true) {
    const frames = [], input = new PassThrough(), raw = []; input.isTTY = tty; input.setRawMode = value => raw.push(value);
    const output = new Writable({write(chunk, encoding, done) {frames.push(chunk.toString());done();}});output.columns = 24;output.rows = 10;
    try {
      const result = fn({message: "Pick", options, initialValues, required, input, output});
      for (const name of keys) input.emit("keypress", name === "space" ? " " : name, {name, ctrl: name === "c"});
      return {value: await result, frames, raw};
    } catch (error) {return {error: error.message, frames, raw};}
    finally {input.destroy();output.destroy();}
  }
  for (const initial of [undefined, [], ["a"], ["b", "a", "missing"]]) for (const keys of [["return"], ["space", "down", "space", "return"], ["up", "left", "right", "space", "return"], ["a", "return"], ["a", "a", "i", "return"], ["i", "return"], ["c"]]) assert.deepEqual(await observe(multiselectPrompt, initial, keys), await observe(original, initial, keys));
  assert.deepEqual(await observe(multiselectPrompt, [], ["return", "space", "return"], true), await observe(original, [], ["return", "space", "return"], true));
  const previous = process.env.POE_NO_PROMPT;
  try {for (const mode of ["0", "1"]) {process.env.POE_NO_PROMPT = mode;assert.deepEqual(await observe(multiselectPrompt, ["c"], [], false, false), await observe(original, ["c"], [], false, false));}}
  finally {if (previous === undefined) delete process.env.POE_NO_PROMPT;else process.env.POE_NO_PROMPT = previous;}
});

function capture(fn, Base, opts) {const saved = Base.prototype.prompt;Base.prototype.prompt = function() {return this;};try {return fn(opts);} finally {Base.prototype.prompt = saved;}}

test("multiselect preserves option/value identity, array species and SameValueZero quirks", async () => {
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  const {multiselectPrompt} = await import("toolcraft-design-rust/prompts/interactive/multiselect");
  function observe(fn, Base) {
    const trace = [], value = {id: 1};
    class Values extends Array {static get [Symbol.species]() {trace.push("species");return Values;}}
    const options = [{value: NaN, label: "NaN"}, {value, label: "Object"}, {value: -0, label: "Zero"}, {value: 3, label: "Disabled", disabled: true}];
    const initialValues = [value]; const p = capture(fn, Base, {message: "Values", options, initialValues});
    trace.push(p.value !== initialValues, p.value[0] === value, p.visibleOptions === options, Object.keys(p), Object.getOwnPropertyNames(Object.getPrototypeOf(p)));
    p.value = Values.of(NaN, value, -0, 3);
    for (const item of [NaN, value, 0, "new", NaN]) {p.toggleValue(item);trace.push([...p.value], p.value instanceof Values);}
    p.toggleAll();trace.push([...p.value]);p.toggleAll();trace.push([...p.value]);p.invert();trace.push([...p.value]);
    p._cursor = 3;p.toggleFocused();trace.push([...p.value]);
    for (const state of ["active", "error", "submit", "cancel"]) {p.state = state;trace.push(p.renderFrame(p));}
    return trace;
  }
  assert.deepEqual(observe(multiselectPrompt, Prompt), observe(original, OriginalPrompt));
});

test("multiselect preserves constructor, property, callback and setter lookup order", async () => {
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  const {multiselectPrompt} = await import("toolcraft-design-rust/prompts/interactive/multiselect");
  function observe(fn, Base, kind) {
    const trace = [], failure = {};
    const values = kind === "empty" ? [] : kind === "disabled" ? [{value: 0, label: "Zero", disabled: true}] : Array.from({length: 5}, (_, value) => ({value, label: String(value), hint: "hint"}));
    const options = values.map(value => new Proxy(value, {get(target, key) {trace.push(["option", target.value, key]);return target[key];}}));
    const opts = new Proxy({message: "Values", options, initialValues: [1, 2, 3, 4], required: true}, {get(target, key) {trace.push(["opts", key]);return target[key];}});
    let p;try {p = capture(fn, Base, opts);} catch (error) {return [error.message, trace];}
    for (const key of ["state", "value", "_cursor", "options", "error"]) {let value = p[key];Object.defineProperty(p, key, {get() {trace.push(["get", key]);return value;}, set(next) {trace.push(["set", key, next]);value = next;}});}
    for (const method of ["setValue", "toggleValue", "enabledOptions"]) {const fn = p[method];Object.defineProperty(p, method, {configurable: true, get() {trace.push(["method", method]);return function(...args) {trace.push(["call", method, this === p]);return Reflect.apply(fn, this, args);};}});}
    for (const state of ["active", "error", "submit", "cancel"]) {p.state = state;trace.push(p.renderFrame(p));}
    p.toggleFocused();p.toggleValue(1);p.toggleAll();p.invert();
    for (const value of [undefined, [], [1]]) trace.push(p.validate(value));
    p.value = {get includes() {trace.push("includes");throw failure;}};
    // Do not let deepEqual evaluate the throwing getter in the recorded value.
    trace.pop();
    assert.throws(() => p.toggleValue(1), error => error === failure);
    return trace;
  }
  for (const kind of ["empty", "disabled", "normal"]) assert.deepEqual(observe(multiselectPrompt, Prompt, kind), observe(original, OriginalPrompt, kind));
});
