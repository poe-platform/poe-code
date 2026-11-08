import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/keymap.js";

test("dashboard keymap preserves canonical aliases, modifiers and Unicode sequences", async () => {
  const native = await import("toolcraft-design-rust/dashboard/keymap");
  assert.deepEqual(Object.keys(native), Object.keys(original));
  for (const key of ["", " ", "+", "++", "a", "A", "ß", "İ", "é", "É", "😀", "gg", "gG", "界文", "space", "↑", "↓", "←", "→", "return", "PageDown", "x\ty", "x\u007fy", "x\ny"]) for (const prefix of ["", "Ctrl+", "Control+", "Meta+", "Alt+Shift+", "unknown+", " ctrl + + shift + "]) assert.equal(native.canonicalizeBinding(prefix + key), original.canonicalizeBinding(prefix + key));
  assert.equal(native.createKeymap.name, original.createKeymap.name);assert.equal(native.createKeymap.length, original.createKeymap.length);
  const a = native.createKeymap(), b = original.createKeymap();
  for (const key of ["q", "e", "p", "r", "l", "up", "down", "pageup", "pagedown", "f", "F", "end", "g", "c", "x"]) for (const ctrl of [false, true, undefined]) for (const meta of [false, true]) for (const shift of [false, true]) {
    const event = {name: key.toLowerCase(), ch: key.length === 1 ? key : undefined, ctrl, meta, shift};assert.equal(a(event), b(event));
  }
});

test("generic keymaps preserve sequence prefixes, reset rules and mutable command order", async () => {
  const {createKeymap} = await import("toolcraft-design-rust/dashboard/keymap");
  function observe(factory) {
    const commands = ["go", "top", "single", "quit"], defaultBindings = {go: ["gx"], top: ["gg", "G"], single: ["x"], quit: ["Ctrl+C"]};
    const resolve = factory(undefined, {commands, defaultBindings}); const output = [];
    for (const ch of ["g", "g", "g", "x", "g", "z", "g", "g", "G"]) output.push(resolve({ch, name: ch.toLowerCase(), ctrl: false, meta: false, shift: ch === "G"}));
    for (const event of [{ch: "g", ctrl: false, meta: false, shift: false}, {name: "up", ctrl: false, meta: false, shift: false}, {ch: "g", ctrl: true, meta: false, shift: false}, {ch: "g", ctrl: false, meta: false, shift: false}, {ch: "g", ctrl: false, meta: false, shift: false}]) output.push(resolve(event));
    commands.splice(0, 1);output.push(resolve({ch: "g", ctrl: false, meta: false, shift: false}), resolve({ch: "x", ctrl: false, meta: false, shift: false}));
    return output;
  }
  assert.deepEqual(observe(createKeymap), observe(original.createKeymap));
});

test("keymap construction and matching preserve getter order, iterator closing and throws", async () => {
  const {createKeymap, canonicalizeBinding} = await import("toolcraft-design-rust/dashboard/keymap");
  function observe(factory) {
    const trace = [], failure = {};
    const commands = {[Symbol.iterator]() {trace.push("iterator");let i = 0;return {next() {trace.push("next");return i++ ? {done: true} : {done: false, value: "go"};}, return() {trace.push("return");return {done: true};}};}};
    const options = new Proxy({commands, defaultBindings: {go: ["gg", "Ctrl+X"]}}, {get(target, key) {trace.push(["options", key]);return target[key];}});
    const overrides = new Proxy({}, {get(target, key) {trace.push(["override", key]);return target[key];}});
    const resolve = factory(overrides, options);
    for (const entry of [{ch: "g", ctrl: false, meta: false, shift: false}, {ch: "g", ctrl: false, meta: false, shift: false}, {ch: "x", name: "x", ctrl: true, meta: false, shift: false}]) {
      trace.push(resolve(new Proxy(entry, {get(target, key) {trace.push(["event", key]);return target[key];}})));
    }
    assert.throws(() => resolve({get ctrl() {throw failure;}}), error => error === failure);
    return trace;
  }
  assert.deepEqual(observe(createKeymap), observe(original.createKeymap));
  function canonical(fn) {
    const trace = [];
    const input = {trim() {trace.push("trim");return {length: 3, split(separator) {trace.push(["split", separator]);return ["Ctrl", "X"];}};}};
    return [fn(input), trace];
  }
  assert.deepEqual(canonical(canonicalizeBinding), canonical(original.canonicalizeBinding));
});
