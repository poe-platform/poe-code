import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/buffer.js";

test("legacy buffer preserves clipped Unicode, tabs, ANSI, resize and cell copies", async () => {
  const native = await import("toolcraft-design-rust/dashboard/buffer");
  assert.deepEqual(Object.keys(native), Object.keys(original));
  for (const text of ["abc", "界👩‍💻éX", "a\tb", "a\nB\rC", "a\x1b[31mB\x1b[0mC", "\x1b[2JC", "\u0000x\u009by"]) {
    for (const x of [-2, 0, 3, 6]) {
      const a = new native.ScreenBuffer(7, 2), b = new original.ScreenBuffer(7, 2);
      for (const buffer of [a, b]) {
        buffer.put(x, 0, text, {fg: "blue", underline: true, bold: false});
        buffer.putInRect({x, y: 1, width: 4, height: 1}, 0, text, {dim: true});
      }
      assert.deepEqual({...a}, {...b});
      assert.deepEqual(native.diff(new native.ScreenBuffer(1, 1), a), original.diff(new original.ScreenBuffer(1, 1), b));
      for (const buffer of [a, b]) {
        const cell = buffer.get(0, 0); cell.ch = "changed"; cell.style.fg = "red";
        buffer.resize(5, 3);
        buffer.clearRect({x: -1, y: 1, width: 3, height: 4}, {bg: "black"});
      }
      assert.deepEqual({...a}, {...b});
      assert.deepEqual(a.get(-1, 0), b.get(-1, 0));
      a.clear({inverse: false}); b.clear({inverse: false});
      assert.deepEqual({...a}, {...b});
      assert.equal(a._cells[0].style, a._cells[1].style);
    }
  }
});

test("legacy buffer preserves normalization, fractional addressing and runtime methods", async () => {
  const native = await import("toolcraft-design-rust/dashboard/buffer");
  for (const [width, height] of [[-1, 2], [2.9, 1.8], [NaN, 1], [1, NaN], [0, 0]]) {
    const a = new native.ScreenBuffer(width, height), b = new original.ScreenBuffer(width, height);
    for (const buffer of [a, b]) { buffer.put(0.5, 0, "abc"); buffer.put(0, 0.5, "x"); }
    assert.deepEqual({...a}, {...b});
    for (const method of ["index", "isInBounds", "isInBoundsX", "isInBoundsY"]) assert.equal(a[method](0.5, 0), b[method](0.5, 0));
  }
});

test("ordinary buffer diffs retain exact styles, Unicode, dimensions and owned cell copies", async () => {
  const native = await import("toolcraft-design-rust/dashboard/buffer");
  for (const size of [[0, 3], [3, 0], [2, 2], [7, 1]]) {
    function observe(api) {
      const previous = new api.ScreenBuffer(...size), next = new api.ScreenBuffer(3, 2);
      previous.put(0, 0, "界A", {bold: false, fg: "red"});
      next.put(0, 0, "界A", {bold: true, fg: "red"});
      next._cells[3] = {ch: "\ud800", style: {dim: false, fg: undefined}};
      const changes = api.diff(previous, next);
      assert.deepEqual(api.diff(next, next), []);
      const retained = structuredClone(changes);
      for (const change of changes) { change.cell.ch = "changed"; change.cell.style.bold = false; }
      assert.deepEqual(api.diff(previous, next), retained);
      return retained;
    }
    assert.deepEqual(observe(native), observe(original));
  }
});

test("ordinary buffer diff falls back for overridden methods and accessor cells", async () => {
  const native = await import("toolcraft-design-rust/dashboard/buffer");
  for (const mode of ["get", "cell", "style", "proxy"]) {
    function observe(api) {
      const trace = [], previous = new api.ScreenBuffer(2, 1), next = new api.ScreenBuffer(2, 1);
      if (mode === "get") {
        const get = next.get;
        next.get = function(x, y) { trace.push([x, y]); return get.call(this, x, y); };
      } else if (mode === "cell") {
        Object.defineProperty(next._cells, 0, {get() { trace.push("cell"); return {ch: "X", style: {}}; }});
      } else if (mode === "style") {
        next._cells[0].style = {get bold() { trace.push("style"); return false; }};
      } else {
        next._cells = new Proxy(next._cells, {get(target, key) { trace.push(key); return Reflect.get(target, key); }});
      }
      return {changes: api.diff(previous, next), trace};
    }
    assert.deepEqual(observe(native), observe(original));
  }
});

test("legacy buffer preserves style/rectangle getter order, public diff calls and thrown identity", async () => {
  const native = await import("toolcraft-design-rust/dashboard/buffer");
  function observe(api) {
    const trace = [], buffer = new api.ScreenBuffer(3, 2);
    const proxy = (tag, value) => new Proxy(value, {get(target, key) {trace.push([tag, key]); return target[key];}});
    const style = proxy("style", {fg: "red", bold: false, underline: true});
    buffer.put(0, 0, "a", style);
    buffer.putInRect(proxy("rect", {x: 0, y: 0, width: 2, height: 1}), 0, "a\nb", style);
    buffer.clearRect(proxy("rect", {x: -1, y: 0, width: 3, height: 1}), style);
    buffer.clear(style);
    const cell = {ch: "a", style: proxy("cellStyle", {fg: "red", underline: true})};
    const surface = tag => ({get width(){trace.push(tag + "width");return 1;}, get height(){trace.push(tag + "height");return 1;}, get(x,y){trace.push([tag,x,y]);return cell;}});
    trace.push(api.diff(surface("prev"), surface("next")));
    const failure = {};
    assert.throws(() => buffer.put(0, 0, "x", {get fg(){throw failure;}}), value => value === failure);
    return trace;
  }
  assert.deepEqual(observe(native), observe(original));
});

test("legacy cell ANSI preserves chain order, color names and empty continuations", async () => {
  const native = await import("toolcraft-design-rust/dashboard/buffer");
  const previous = process.env.FORCE_COLOR; process.env.FORCE_COLOR = "1";
  try {
    for (const ch of ["", "X", "a\nb"]) for (const fg of [undefined, "red", "#abc", "bogus", "bold"]) for (const bg of [undefined, "blue", "bgRed", "#123456", "bogus"]) {
      const cell = {ch, style: {fg, bg, bold: true, dim: true, inverse: true, underline: true}};
      assert.equal(native.cellToAnsi(cell), original.cellToAnsi(cell));
    }
  } finally { if (previous === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = previous; }
});
