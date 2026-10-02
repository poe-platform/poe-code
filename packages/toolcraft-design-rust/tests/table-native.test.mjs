import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTable, loggerTableWidth } from "../dist/table.js";
import { withOutputFormat } from "../dist/logging.js";
import { renderTable as reference, loggerTableWidth as referenceWidth } from "../../toolcraft-design/dist/components/table.js";
import { withOutputFormat as referenceFormat } from "../../toolcraft-design/dist/internal/output-format.js";

const theme = { header: value => value, muted: value => value };
const columns = [
  { name: "id", title: "ID", alignment: "left", maxLen: 7 },
  { name: "value", title: "Value", alignment: "right", maxLen: 24 }
];

test("table public subpaths preserve the reference export surface and shared implementation", async () => {
  const root = await import("toolcraft-design-rust");
  const flat = await import("toolcraft-design-rust/render-table");
  const component = await import("toolcraft-design-rust/components/table");
  const referenceFlat = await import("toolcraft-design/render-table");
  const referenceComponent = await import("toolcraft-design/components/table");
  assert.deepEqual(Object.keys(flat), Object.keys(referenceFlat));
  assert.deepEqual(Object.keys(component), Object.keys(referenceComponent));
  assert.equal(flat.renderTable, root.renderTable);
  assert.equal(component.renderTable, root.renderTable);
  assert.equal(component.loggerTableWidth, root.loggerTableWidth);
});

test("native tables preserve terminal, Markdown and JSON output over Unicode and ANSI cells", () => {
  const values = ["", "alpha|beta\r\nsecond", "東京", "👨‍👩‍👧".repeat(15), "a\u0301".repeat(30), "\ud800 lone", "\x1b[31m" + "x".repeat(60) + "\x1b[0m"];
  for (const format of ["terminal", "markdown", "json"]) {
    for (const variant of [undefined, "detail"]) {
      for (const maxWidth of [undefined, 1, 30, 60, 200, NaN]) {
        const options = { theme, columns, rows: values.map((value, index) => ({ id: String(index), value })), maxWidth, variant };
        assert.equal(withOutputFormat(format, () => renderTable(options)), referenceFormat(format, () => reference(options)));
      }
    }
  }
  assert.equal(loggerTableWidth(), referenceWidth());
});

test("native tables preserve accessor order, theme receivers and array species", () => {
  function run(render, scope, format, variant) {
    const trace = [];
    const observe = (object, name) => new Proxy(object, { get(target, key, receiver) { trace.push(`${name}.${String(key)}`); return Reflect.get(target, key, receiver); } });
    const palette = { header(value) { assert.equal(this, palette); trace.push(`header:${value}`); return value; }, muted(value) { assert.equal(this, palette); trace.push(`muted:${value}`); return value; } };
    class Rows extends Array { static get [Symbol.species]() { trace.push("species"); return Array; } }
    const rows = new Rows(observe({ id: "a", value: "Hello" }, "row"));
    const options = observe({ theme: palette, columns: columns.map((column, i) => observe(column, `column${i}`)), rows, variant, maxWidth: 29 }, "options");
    return { result: scope(format, () => render(options)), trace };
  }
  for (const format of ["terminal", "markdown", "json"])
    for (const variant of [undefined, "detail"])
      assert.deepEqual(run(renderTable, withOutputFormat, format, variant), run(reference, referenceFormat, format, variant));
});

test("native tables retain own-cell selection, separators and invalid width diagnostics", () => {
  for (const row of [Object.create({ id: "inherited", value: "hidden" }), { id: null, value: undefined }, { id: "x", value: "ok" }]) {
    for (const format of ["terminal", "markdown", "json"]) {
      const options = { theme, columns, rows: [row, row], rowSeparators: true };
      assert.equal(withOutputFormat(format, () => renderTable(options)), referenceFormat(format, () => reference(options)));
    }
  }
  for (const maxLen of [0, -1, NaN, Infinity, "8"]) {
    const options = { theme, columns: [{ ...columns[0], maxLen }], rows: [] };
    assert.throws(() => renderTable(options), { message: "maxLen must be a positive finite number." });
  }
  const failure = { rejected: true };
  assert.throws(() => renderTable({ theme: { ...theme, header() { throw failure; } }, columns, rows: [] }), error => error === failure);
});

test("table coercion, changing widths, sparse columns and reentrant themes preserve host behavior", () => {
  function run(render, scope, format, scenario) {
    const trace = [];
    const observe = (object, name) => new Proxy(object, {
      get(target, key, receiver) { trace.push(`${name}.${String(key)}`); return Reflect.get(target, key, receiver); },
      has(target, key) { trace.push(`${name}?${String(key)}`); return Reflect.has(target, key); }
    });
    let reads = 0;
    const first = {
      ...columns[0],
      get maxLen() { trace.push("maxLen"); return ++reads === 1 ? 7 : 8; },
      minLen: { valueOf() { trace.push("minLen.valueOf"); return 4; } }
    };
    const palette = {
      muted(value) { trace.push(`muted:${value}`); return value; },
      header(value) {
        trace.push(`header:${value}`);
        if (scenario === "reentrant") {
          assert.equal(scope("json", () => render({ columns: [], rows: [{}] })), "[\n  {}\n]");
        }
        return value;
      }
    };
    const selectedColumns = observe([observe(first, "column0"), observe(columns[1], "column1")], "columns");
    if (scenario === "sparse") delete selectedColumns[0];
    const options = {
      theme: palette, columns: selectedColumns,
      rows: observe([observe({ id: "a", value: "some value" }, "row")], "rows"),
      variant: scenario === "detail" ? "detail" : undefined,
      maxWidth: { valueOf() { trace.push("maxWidth.valueOf"); return 29.5; } },
      get rowSeparator() { trace.push("rowSeparator"); return true; },
      get rowSeparators() { throw new Error("must short circuit"); }
    };
    try { return { result: scope(format, () => render(options)), trace }; }
    catch (error) { return { error: [error.name, error.message], trace }; }
  }
  for (const format of ["terminal", "markdown", "json"]) {
    for (const scenario of ["coercion", "sparse", "reentrant", "detail"]) {
      assert.deepEqual(run(renderTable, withOutputFormat, format, scenario), run(reference, referenceFormat, format, scenario));
    }
  }
});
