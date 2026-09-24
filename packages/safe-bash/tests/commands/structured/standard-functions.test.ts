import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { row, run } from "./helpers.js";

const cases = [
  row('[0,1,2,3]', 'del(.[1:3][0])', [[0,2,3]]),
  row('[0,1,2,3]', '.[-2:] += [9]', [[0,1,2,3,9]]),
  row('[0,1,2,3]', '.[0.5:2.2] = [9]', [[9,3]]),
  row('[0,1,2,3]', '.[1:3][] |= .+10', [[0,11,12,3]]),
  row('"A😀BC"', '.[1.5:2.1]', ['😀B']),
  row('[1,[2,[3]]]', 'flatten(0.5)', [[1,2,3]]),
  row('{"a":[1,[2]]}', 'flatten', [[1,2]]),
  row('"é"', '@base64 | @base64d', ['é']),
  row('"!()*\'"', '@uri', ['%21%28%29%2A%27']),
  row('["a\\nb","c\\\\d"]', '@tsv', ['a\\nb\tc\\\\d']),
  row('{"names":["a b","c/d"]}', '[@uri "q=\\(.names[])&x=1"]', [['q=a%20b&x=1','q=c%2Fd&x=1']]),
  row('[1,2,3]', '(.[] | select(. > 1)) |= . * 10', [[1,20,30]]),
  row('{"a":{"b":1}}', '(.a | .b) = 2', [{a:{b:2}}]),
  row('[0,1,2,3]', '.[1:3] = [9,9,9]', [[0,9,9,9,3]]),
  row('[0,1,2,3]', '.[1:3] |= reverse', [[0,2,1,3]]),
  row('[0,1,2,3]', 'del(.[1:3])', [[0,3]]),
  row('{"a":1}', '.a? |= . + 1', [{a:2}]),
  row('[1,{"a":2}]', '(.[] | .a?) |= . + 1', [[1,{a:3}]]),
  row('[1,{"a":2}]', '(.. | numbers) |= . + 1', [[2,{a:3}]]),
  row('5', 'if . > 0 then . * 2 end', [10]),
  row('-5', 'if . > 0 then . * 2 end', [-5]),
  row('0', 'if . > 0 then 1 elif . < 0 then -1 end', [0]),
  row('[10,20,30,40]', '.[0.5:2.2]', [[10,20,30]]),
  row('"abcd"', '.[0.5:2.2]', ['abc']),
  row('[1,[2,[3]]]', 'flatten', [[1,2,3]]),
  row('[1,[2,[3]]]', 'flatten(1)', [[1,2,[3]]]),
  row('[1,[2,[3]]]', 'flatten(0)', [[1,[2,[3]]]]),
  row('"hello"', '@base64', ['aGVsbG8=']),
  row('"aGVsbG8="', '@base64d', ['hello']),
  row('"a b/é"', '@uri', ['a%20b%2F%C3%A9']),
  row('["a,b",2,null,true]', '@csv', ['"a,b",2,,true']),
  row('["a\\tb",2,null]', '@tsv', ['a\\tb\t2\t']),
  row('["a b","x\'y"]', '@sh', ["'a b' 'x'\\''y'"]),
  row('{"a":1}', '@json', ['{"a":1}']),
  row('42', '@text', ['42']),
  row('"<&>"', '@html', ['&lt;&amp;&gt;']),
  row('{"name":"a b"}', '@uri "q=\\(.name)"', ['q=a%20b']),
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


test("new jq features preserve resource errors through optional paths", async () => {
  for (const [filter, input, limits] of [
    ['(.[] | select(. > 1))? |= .+1', '[1,2,3]', {maxSteps: 10}],
    ['(.. | numbers)? |= .+1', '[1,[2,[3]]]', {maxSteps: 20}],
    ['flatten', '[1,[2,3]]', {maxCollectionSize: 2}],
    ['@uri', '"éé"', {maxValueBytes: 8}],
    ['@html', '"&&"', {maxValueBytes: 8}],
  ] as const) {
    const result = await run(['-c', filter], input, {limits});
    assert.equal(result.exitCode, 5, filter);
    assert.match(result.stderr, /limit exceeded/, filter);
  }
});

test("invalid flatten depths and formats fail as jq errors", async () => {
  for (const [filter, input] of [['flatten(-1)', '[]'], ['flatten("x")', '[]'], ['@csv', '1'], ['@tsv', '[{}]'], ['@sh', '{}'], ['@base64d', '"*"'], ['@missing', 'null']]) {
    const result = await run(['-c', filter!], input!);
    assert.equal(result.exitCode, 5, filter);
    assert.doesNotMatch(result.stderr, /TypeError/);
  }
});
