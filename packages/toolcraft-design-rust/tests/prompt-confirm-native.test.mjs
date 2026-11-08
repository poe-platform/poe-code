import assert from "node:assert/strict";
import {test} from "node:test";
import {PassThrough, Writable} from "node:stream";
import {Prompt as OriginalPrompt} from "../../toolcraft-design/dist/prompts/interactive/core.js";
import {confirmPrompt as originalConfirm} from "../../toolcraft-design/dist/prompts/interactive/confirm.js";
import * as originalGlyphs from "../../toolcraft-design/dist/prompts/interactive/glyphs.js";
import {color as originalColor} from "../../toolcraft-design/dist/components/color.js";

test("interactive glyphs preserve live mutable symbols and colors", async () => {
  const native = await import("toolcraft-design-rust/prompts/interactive/glyphs");
  const {color} = await import("toolcraft-design-rust");
  assert.deepEqual(Object.keys(native), Object.keys(originalGlyphs));
  assert.deepEqual(native.GLYPHS, originalGlyphs.GLYPHS);
  assert.equal(native.UNICODE, originalGlyphs.UNICODE);
  function observe(api, palette) {
    const trace = [], saved = Object.getOwnPropertyDescriptors(palette), glyphs = Object.getOwnPropertyDescriptors(api.GLYPHS);
    try {
      for (const name of ["red", "yellow", "green", "cyan"]) Object.defineProperty(palette, name, {configurable: true, get() {
        trace.push(["color", name]); return function(value) {trace.push(["call", name, this === palette]); return `${name}:${value}`;};
      }});
      for (const name of Object.keys(api.GLYPHS)) Object.defineProperty(api.GLYPHS, name, {configurable: true, get() {trace.push(["glyph", name]); return name;}});
      for (const state of ["initial", "active", "submit", "cancel", "error", undefined, {}, new String("submit")]) {
        trace.push(api.symbol(state), api.symbolBar(state));
      }
      return trace;
    } finally {Object.defineProperties(palette, saved); Object.defineProperties(api.GLYPHS, glyphs);}
  }
  assert.deepEqual(observe(native, color), observe(originalGlyphs, originalColor));
});

test("interactive glyph selection preserves platform and environment short circuiting", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform"), env = process.env;
  let serial = 0;
  async function observe(module, platformValue, values) {
    const trace = [];
    Object.defineProperty(process, "platform", {configurable: true, value: platformValue});
    process.env = new Proxy(values, {get(target, name) {trace.push(name); return target[name];}});
    try {
      const api = await import(new URL(`../../${module}/dist/${module.endsWith("rust") ? "prompt-glyphs" : "prompts/interactive/glyphs"}.js?case=${serial++}`, import.meta.url));
      return {unicode: api.UNICODE, glyphs: api.GLYPHS, trace: trace.filter(name => ["TERM", "CI", "WT_SESSION", "TERMINUS_SUBLIME", "ConEmuTask", "TERM_PROGRAM", "TERMINAL_EMULATOR"].includes(name))};
    } finally {process.env = env; Object.defineProperty(process, "platform", platform);}
  }
  for (const platformValue of ["darwin", "linux", "win32"]) {
    for (const values of [{}, {TERM: "linux"}, {CI: "0"}, {WT_SESSION: "session"}, {TERMINUS_SUBLIME: "1"}, {ConEmuTask: "{cmd::Cmder}"}, {TERM_PROGRAM: "Terminus-Sublime"}, {TERM_PROGRAM: "vscode"}, {TERM: "xterm-256color"}, {TERM: "alacritty"}, {TERMINAL_EMULATOR: "JetBrains-JediTerm"}]) {
      assert.deepEqual(await observe("toolcraft-design-rust", platformValue, values), await observe("toolcraft-design", platformValue, values));
    }
  }
});

test("confirmation prompts preserve frames, shortcuts, cancellation and defaults", async () => {
  const {confirmPrompt} = await import("toolcraft-design-rust/prompts/interactive/confirm");
  assert.equal(confirmPrompt.name, originalConfirm.name); assert.equal(confirmPrompt.length, originalConfirm.length);
  async function observe(fn, keys, initialValue, tty = true) {
    const frames = [], raw = [], input = new PassThrough();
    input.isTTY = tty; input.setRawMode = value => raw.push(value);
    const output = new Writable({write(chunk, encoding, done) {frames.push(chunk.toString()); done();}});
    output.columns = 30;
    try {
      const result = fn({message: "Continue?", initialValue, input, output});
      for (const [char, key] of keys) input.emit("keypress", char, key);
      return {value: await result, frames, raw, listeners: input.listenerCount("keypress")};
    } catch (error) {return {error: error.message, frames, raw};}
    finally {input.destroy(); output.destroy();}
  }
  const sequences = [[["\r", {name: "return"}]], [["n", {name: "n"}]], [["Y", {name: "y"}]], [[undefined, {name: "left"}], [undefined, {name: "down"}], ["\r", {name: "return"}]], [["\x03", {ctrl: true, name: "c"}]]];
  for (const initialValue of [undefined, null, false, true, 0, "truthy"]) for (const keys of sequences) assert.deepEqual(await observe(confirmPrompt, keys, initialValue), await observe(originalConfirm, keys, initialValue));
  const previous = process.env.POE_NO_PROMPT;
  try {
    for (const env of ["0", "1"]) {
      process.env.POE_NO_PROMPT = env;
      for (const value of [undefined, false, true]) assert.deepEqual(await observe(confirmPrompt, [], value, false), await observe(originalConfirm, [], value, false));
    }
  } finally {if (previous === undefined) delete process.env.POE_NO_PROMPT; else process.env.POE_NO_PROMPT = previous;}
});

test("confirmation subclass preserves observable fields, event order, rendering reads and failures", async () => {
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  const {confirmPrompt} = await import("toolcraft-design-rust/prompts/interactive/confirm");
  function observe(fn, Base) {
    const original = Base.prototype.prompt, trace = [], failure = {};
    Base.prototype.prompt = function() {return this;};
    let p;
    try {
      p = fn(new Proxy({message: "Question", initialValue: false}, {get(target, name) {trace.push(["opts", name]); return target[name];}}));
    } finally {Base.prototype.prompt = original;}
    trace.push(Object.keys(p), Object.getOwnPropertyNames(Object.getPrototypeOf(p)));
    for (const key of ["value", "state"]) {let value = p[key]; Object.defineProperty(p, key, {get() {trace.push(["get", key]); return value;}, set(next) {trace.push(["set", key, next]); value = next;}});}
    for (const state of ["initial", "active", "error", "submit", "cancel"]) {p.state = state; trace.push(p.renderFrame(p));}
    for (const action of ["up", "right", "left", "down", "space", "enter"]) p.emit("cursor", action);
    p.render = () => trace.push("render"); p.close = () => trace.push("close");
    p.on("finalize", () => {trace.push("finalize"); p.value = "reentrant";});
    p.emit("confirm", false);
    p.on("finalize", () => {throw failure;});
    assert.throws(() => p.emit("confirm", true), error => error === failure);
    return trace;
  }
  assert.deepEqual(observe(confirmPrompt, Prompt), observe(originalConfirm, OriginalPrompt));
});
