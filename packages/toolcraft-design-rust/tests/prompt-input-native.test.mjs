import assert from "node:assert/strict";
import {test} from "node:test";
import {PassThrough, Writable} from "node:stream";
import {Prompt as OriginalPrompt} from "../../toolcraft-design/dist/prompts/interactive/core.js";
import {textPrompt as originalText} from "../../toolcraft-design/dist/prompts/interactive/text.js";
import {passwordPrompt as originalPassword} from "../../toolcraft-design/dist/prompts/interactive/password.js";

test("text and password prompts preserve Unicode editing, validation, cancellation and piped input", async () => {
  const {textPrompt} = await import("toolcraft-design-rust/prompts/interactive/text");
  const {passwordPrompt} = await import("toolcraft-design-rust/prompts/interactive/password");
  async function observe(fn, options, keys, tty = true) {
    const frames = [], raw = [], validations = [], input = new PassThrough();
    input.isTTY = tty; input.setRawMode = value => raw.push(value);
    const output = new Writable({write(chunk, encoding, done) {frames.push(chunk.toString()); done();}}); output.columns = 20;
    try {
      const pending = fn({...options, message: "Enter value", input, output, validate(value) {validations.push(value); return value === "" ? "Required" : undefined;}});
      if (tty) for (const [char, key] of keys) input.emit("keypress", char, key);
      else input.end("héllo👩‍👩‍👧‍👦\nremainder");
      return {value: await pending, frames, raw, validations};
    } finally {input.destroy(); output.destroy();}
  }
  const sequences = [
    [["hello", {}], ["\r", {name: "return"}]],
    [["\r", {name: "return"}], ["👩‍👩‍👧‍👦é界", {}], [undefined, {name: "left"}], [undefined, {name: "backspace"}], ["X", {}], ["\r", {name: "return"}]],
    [["secret", {}], ["\x03", {name: "c", ctrl: true}]],
    [["more", {}], [undefined, {name: "home"}], [undefined, {name: "delete"}], ["\r", {name: "return"}]]
  ];
  for (const [fn, original] of [[textPrompt, originalText], [passwordPrompt, originalPassword]]) {
    assert.equal(fn.name, original.name); assert.equal(fn.length, original.length);
    for (const options of [{}, {initialValue: "initial", defaultValue: "default", placeholder: "👩‍👩‍👧‍👦placeholder"}, {mask: "ab"}, {mask: ""}]) {
      for (const keys of sequences) assert.deepEqual(await observe(fn, options, keys), await observe(original, options, keys));
      assert.deepEqual(await observe(fn, options, [], false), await observe(original, options, [], false));
    }
  }
});

test("input subclasses preserve getter order, receiver identity, cursor shapes and rendering", async () => {
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  const {textPrompt} = await import("toolcraft-design-rust/prompts/interactive/text");
  const {passwordPrompt} = await import("toolcraft-design-rust/prompts/interactive/password");
  function observe(fn, Base, options) {
    const trace = [], saved = Base.prototype.prompt;
    Base.prototype.prompt = function() {return this;};
    let p;
    try {p = fn(new Proxy({message: "Question", ...options}, {get(target, key) {trace.push(["opts", key]); return target[key];}}));}
    finally {Base.prototype.prompt = saved;}
    trace.push(Object.keys(p), Object.getOwnPropertyNames(Object.getPrototypeOf(p)));
    for (const key of ["userInput", "value", "state", "error", "mask"]) {
      if (!(key in p)) continue;
      let value = p[key];Object.defineProperty(p, key, {get() {trace.push(["get", key]);return value;}, set(next) {trace.push(["set", key, next]);value = next;}});
    }
    for (const state of ["initial", "active", "error", "submit", "cancel"]) for (const input of ["", "ab", "é👩‍👩‍👧‍👦"]) {
      p.state = state; p.userInput = input; p.value = input;
      for (const cursor of [0, 1, input.length]) {p._cursor = cursor; trace.push(p.userInputWithCursor, p.renderFrame(p));}
    }
    p.state = "submit";p.value = "";p.emit("finalize");
    return trace;
  }
  for (const [fn, original] of [[textPrompt, originalText], [passwordPrompt, originalPassword]]) for (const options of [{}, {initialValue: "a", defaultValue: "fallback", placeholder: "é👩‍👩‍👧‍👦"}, {mask: "**"}, {mask: ""}]) assert.deepEqual(observe(fn, Prompt, options), observe(original, OriginalPrompt, options));
});

test("text validation preserves optional callback lookup, fallback reads and arbitrary throws", async () => {
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  const {textPrompt} = await import("toolcraft-design-rust/prompts/interactive/text");
  function observe(fn, Base, enabled) {
    const trace = [], failure = {}, saved = Base.prototype.prompt;
    const opts = {message: "Text", get validate() {trace.push("validate"); return enabled ? function(value) {trace.push([this === opts, value]); throw failure;} : undefined;}, get defaultValue() {trace.push("default"); return "fallback";}};
    Base.prototype.prompt = function() {return this;};
    let p;
    try {p = fn(opts);} finally {Base.prototype.prompt = saved;}
    for (const value of ["", "present", undefined]) {
      try {trace.push(p.validate(value));} catch (error) {assert.equal(error, failure);trace.push("thrown");}
    }
    return trace;
  }
  for (const enabled of [true, false]) assert.deepEqual(observe(textPrompt, Prompt, enabled), observe(originalText, OriginalPrompt, enabled));
});
