import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { row, run } from "./helpers.js";

const cases = [
  row('[1,2]', 'def sum(f): reduce .[] as $x (0; .+($x|f)); sum(.*2)', [6]),
  row('null', '[try error({a:1}) catch ., try error(false) catch ., try error(null) catch .]', [[{a:1},false,null]]),
  row('{"a":1,"b":2}', 'del(.a)', [{b:2}]),
  row('[0,1,2,3]', 'del(.[1,2,1])', [[0,3]]),
  row('{"a":{"x":1},"b":2}', 'del(.a.x,.b)', [{a:{}}]),
  row('null', 'try error("boom") catch .', ['boom']),
  row('"boom"', 'try error catch .', ['boom']),
  row('null', 'def f(x): x + 1; f(2)', [3]),
  row('3', 'def f(x): . + x; f(.*2)', [9]),
  row('null', 'def f(x;y): [x,y]; f((1,2);3)', [[1,2,3]]),
  row('{"a":1}', 'def f(x): x |= .+1; f(.a)', [{a:2}]),
  row('{"a":1}', 'def f(x): del(x); f(.a)', [{}]),
  row('null', 'def f($x): $x+$x; f((1,2))', [2,4]),
  row('null', 'def f(x): x; def g(y): f(y); g(42)', [42]),
  row('"HELLOéİ"', 'ascii_downcase', ['helloéİ']),
  row('"helloéß"', 'ascii_upcase', ['HELLOéß']),
  row('"hello"', '[startswith("he"),endswith("lo"),ltrimstr("he"),rtrimstr("lo")]', [[true,true,'llo','hel']]),
  row('"hello"', '[ltrimstr(""),rtrimstr(""),ltrimstr("x"),rtrimstr("x")]', [['hello','hello','hello','hello']]),
];
for (const entry of cases) test(`jq standard functions: ${entry.filter}`, async () => {
  const result = await run(['-c', entry.filter], entry.input);
  assert.equal(result.exitCode, entry.status ?? 0, result.stderr);
  assert.equal(result.stdout, entry.output);
  assert.equal(result.stderr, '');
});

test("standard function cases match native jq", () => {
  for (const entry of cases) {
    const result = spawnSync("jq", ["-c", entry.filter], { input: entry.input, encoding: "utf8" });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, entry.output, entry.filter);
  }
});

test("function arity errors are diagnosed before reading input", async () => {
  const stdin = { [Symbol.asyncIterator](): never { throw new Error("unexpected input read"); } };
  for (const source of ["def f($x): x; f(1)", "def f(x): x; f", "def f(x): x; f(1;2)", "error(1;2)", "del", "startswith", "ascii_upcase(1)"]) {
    const result = await run([source], stdin);
    assert.equal(result.exitCode, 3, source);
  }
});
