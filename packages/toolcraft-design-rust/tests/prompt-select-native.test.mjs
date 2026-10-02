import assert from "node:assert/strict";
import {test} from "node:test";
import {PassThrough, Writable} from "node:stream";
import {Prompt as OriginalPrompt} from "../../toolcraft-design/dist/prompts/interactive/core.js";
import {selectPrompt as originalSelect, findNonDisabled as originalFind} from "../../toolcraft-design/dist/prompts/interactive/select.js";

test("select prompts preserve initial selection, disabled navigation and terminal frames", async () => {
  const {selectPrompt} = await import("toolcraft-design-rust/prompts/interactive/select");
  const options = [{value: "a", label: "First", disabled: true}, {value: "b", label: "Second long label", hint: "recommended"}, {value: "c", label: "Third"}, {value: "d", label: "Fourth", disabled: true}, {value: "e", label: "Fifth"}, {value: "f", label: "Sixth\ncontinued"}];
  async function observe(fn, initialValue, actions, tty = true) {
    const frames = [], raw = [], input = new PassThrough();input.isTTY = tty;input.setRawMode = value => raw.push(value);
    const output = new Writable({write(chunk, encoding, done) {frames.push(chunk.toString());done();}});output.columns = 24;output.rows = 9;
    try {
      const result = fn({message: "Choose", options, initialValue, input, output, maxItems: 5});
      for (const name of actions) input.emit("keypress", name === "c" ? "\x03" : undefined, {name, ctrl: name === "c"});
      return {value: await result, frames, raw};
    } catch (error) {return {error: error.message, frames, raw};}
    finally {input.destroy();output.destroy();}
  }
  for (const initial of [undefined, "a", "b", "e", "missing"]) for (const actions of [["return"], ["up", "return"], ["down", "down", "down", "down", "return"], ["left", "right", "space", "return"], ["c"]]) assert.deepEqual(await observe(selectPrompt, initial, actions), await observe(originalSelect, initial, actions));
  const previous = process.env.POE_NO_PROMPT;
  try {for (const env of ["0", "1"]) {process.env.POE_NO_PROMPT = env;assert.deepEqual(await observe(selectPrompt, "e", [], false), await observe(originalSelect, "e", [], false));}}
  finally {if (previous === undefined) delete process.env.POE_NO_PROMPT;else process.env.POE_NO_PROMPT = previous;}
});

test("findNonDisabled preserves wraparound, holes and live property access", async () => {
  const {findNonDisabled} = await import("toolcraft-design-rust/prompts/interactive/select");
  const sparse = [{disabled: true}, {disabled: true}, {disabled: false}];delete sparse[0];
  for (const options of [[], [{disabled: true}], [{disabled: true}, {disabled: false}], sparse]) for (const start of [-5, -1, 0, 1, 4, 2.5, NaN]) for (const direction of [-1, 1]) assert.equal(findNonDisabled(start, direction, options), originalFind(start, direction, options));
  function observe(fn) {
    const trace = [];
    const options = new Proxy([{disabled: true}, {disabled: true}, {disabled: false}], {get(target, key, receiver) {trace.push(key);return Reflect.get(target, key, receiver);}});
    const value = fn(-3, 1, options);return {value, trace};
  }
  assert.deepEqual(observe(findNonDisabled), observe(originalFind));
  for (const result of [1, "yes", {}, 0, "", null]) {
    const options = [{disabled: true}, {disabled: false}];
    options.every = () => result;
    assert.equal(findNonDisabled(0, 1, options), originalFind(0, 1, options));
  }
});

test("select subclass preserves construction failures, mutable options and render getter order", async () => {
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  const {selectPrompt} = await import("toolcraft-design-rust/prompts/interactive/select");
  function observe(fn, Base, kind) {
    const trace = [], saved = Base.prototype.prompt;
    const options = kind === "empty" ? [] : kind === "disabled" ? [{value: "a", label: "A", disabled: true}] : [{value: "a", label: "A", hint: "hint"}, {value: "b", label: "B", disabled: true}, {value: "c", label: "C"}];
    const tracked = options.map(option => new Proxy(option, {get(target, key) {trace.push(["option", target.value, key]);return target[key];}}));
    const opts = new Proxy({message: "Choice", initialValue: "a", options: tracked}, {get(target, key) {trace.push(["opts", key]);return target[key];}});
    Base.prototype.prompt = function() {return this;};let p;
    try {p = fn(opts);} catch (error) {return {error: error.message, trace};} finally {Base.prototype.prompt = saved;}
    trace.push(Object.keys(p), Object.getOwnPropertyNames(Object.getPrototypeOf(p)), p.visibleOptions === tracked);
    for (const key of ["state", "value", "_cursor", "options"]) {let value = p[key];Object.defineProperty(p, key, {get() {trace.push(["get", key]);return value;}, set(next) {trace.push(["set", key, next]);value = next;}});}
    for (const action of ["up", "down", "left", "right", "space"]) p.emit("cursor", action);
    options[0].label = "changed";
    for (const state of ["active", "submit", "cancel"]) {p.state = state;trace.push(p.renderFrame(p));}
    return trace;
  }
  for (const kind of ["empty", "disabled", "normal"]) assert.deepEqual(observe(selectPrompt, Prompt, kind), observe(originalSelect, OriginalPrompt, kind));
});
