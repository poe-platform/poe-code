import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, defaultJqLimits, JqError, JqLimitError, type Json } from "../../../src/commands/structured/limits.js";
import { sliceValue } from "../../../src/commands/structured/values.js";
import { Interpreter } from "../../../src/commands/structured/interpreter.js";
import { parse } from "../../../src/commands/structured/parser.js";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";
import { row, run, type Case } from "./helpers.js";

export const cases: Case[] = [
  row("null", "[(1,2)+(10,20)]", [[11, 12, 21, 22]]),
  row("null", "{a:(1,2),b:(10,20)}", [{ a: 1, b: 10 }, { a: 1, b: 20 }, { a: 2, b: 10 }, { a: 2, b: 20 }]),
  row("[1,2]", "map((.,.+10))", [[1, 11, 2, 12]]),
  row("[1,2]", "[.[]|select((true,false,true))]", [[1, 1, 2, 2]]),
  row("null", "{a:empty,b:1},[empty]", [[]]),
  row("[1,2]", ".[]|.,.+10", [1, 11, 2, 12]),
  row("null", "[(1,2)<(1,2)]", [[false, false, true, false]]),
  row("null", "[(false,true) and (false,true)]", [[false, false, true]]),
  row("null", "[(true,false) or (true,false)]", [[true, true, false]]),
  row("null", "false and (1/0),true or (1/0)", [false, true]),
  row("null", "(false,1,null,2)//9", [1, 2]),
  row("null", "(false,null)//(8,9)", [8, 9]),
  row("null", "[(false,null,1)|.//9]", [[9, 9, 1]]),
  row("null", '[false,null,0,"",[],{}]|map(.//=9)', [[9, 9, 0, "", [], {}]]),
  row("null", '[1=="1",null==false,[]=={}]', [[false, false, false]]),
  row("null", "[{b:1,a:2}=={a:2,b:1},[1,2]==[2,1]]", [[true, false]]),
  row('[{},[],"a",2,true,false,null,-1,[0],{"a":0}]', "sort", [[null, false, true, -1, 2, "a", [], [0], {}, { a: 0 }]]),
  row('["😀","\uE000","z","A","é","é"]', "sort", [["A", "é", "z", "é", "\uE000", "😀"]]),
  row('[{"b":0},{"a":2},{"a":1,"b":0},{"a":1}]', "sort", [[{ a: 1 }, { a: 2 }, { a: 1, b: 0 }, { b: 0 }]]),
  row('["b",2,"a",1,2,"b",null]', "unique", [[null, 1, 2, "a", "b"]]),
  row('[{"k":2,"v":"x"},{"k":1,"v":"y"},{"k":2,"v":"z"}]', "group_by(.k)", [[[{ k: 1, v: "y" }], [{ k: 2, v: "x" }, { k: 2, v: "z" }]]]),
  row('"A😀B"', "length,.[1:2]", [3, "😀"]),
  row("[0,1,2,3]", ".[-8:99],.[3:1],.[99]", [[0, 1, 2, 3], [], null]),
  row("{}", ".constructor,.toString", [null, null]),
  row('[null,false,0,"",[],{}]', "[.[]|values]", [[false, 0, "", [], {}]]),
  row('[null,false,0,"",[],{}]', "map(type)", [["null", "boolean", "number", "string", "array", "object"]]),
  row('{"a":null}', 'has("a")', [true]),
  row("[null]", "has(0)", [true]),
  row("[null]", 'has("0")', [], 5),
  row("[1]", "contains([1,1])", [true]),
  row("{}", "contains({a:null})", [false]),
  row('"abcd"', 'contains("bc")', [true]),
  row("[]", "add", [null]),
  row('["a","b"]', "add", ["ab"]),
  row("[[1],[2]]", "add", [[1, 2]]),
  row('[{"a":1},{"a":2,"b":3}]', "add", [{ a: 2, b: 3 }]),
  row('{"10":"ten","2":"two","a":0}', ".[],keys", ["ten", "two", 0, ["10", "2", "a"]]),
  row('{"a":1,"b":2}', "(.a,.b)=(10,20)", [{ a: 10, b: 10 }, { a: 20, b: 20 }]),
  row('{"a":1,"b":2}', "(.a,.b)|=(.,.+10)", [{ a: 1, b: 2 }]),
  row('{"a":1,"b":2}', ".a=.b", [{ a: 2, b: 2 }]),
  row('{"a":1,"b":2}', ".a|=.b", [], 5),
  row('{"a":1,"b":2}', ".a|=empty", [{ b: 2 }]),
  row('{"a":1,"b":2}', ".a=empty", []),
  row('{"a":1}', ".a|=(empty,99)", [{ a: 99 }]),
  row('{"a":1}', ".a|=(7,1/0)", [{ a: 7 }]),
  row("[0,1,2,3]", ".[1,2]|=empty", [[0, 3]]),
  row("null", ".a.b=1", [{ a: { b: 1 } }]),
  row("[]", ".[2]=7", [[null, null, 7]]),
  row("[]", ".[-1]=7", [], 5),
  row('{"a":{"b":1}}', "(.a.b=2),.", [{ a: { b: 2 } }, { a: { b: 1 } }]),
  row("{}", ".a=. | .a.x=1", [{ a: { x: 1 } }]),
  row("null", "first((1,1/0))", [1]),
  row("null", "limit(1;(1,1/0))", [1]),
  row("null", "first({a:(1,1/0)})", [{ a: 1 }]),
  row('{"a":1,"b":2}', ".a += .b", [{ a: 3, b: 2 }]),
  row('{"a":1}', "(.a,.a) |= .+1", [{ a: 3 }]),
  row('{"a":[10,20],"b":1}', ".a[.b]", [20]),
  row("[1,2,3]", "map_values(select(.>1))", [[2, 3]]),
  row('{"a":1,"b":2}', "map_values(.,.+10)", [{ a: 1, b: 2 }]),
  row("null", "[range(5;0;-2)]", [[5, 3, 1]]),
  row("null", "if false then 1 elif true then 2 else 3 end", [2]),
  row("[1,null,{},false]", "[.[] | .a?]", [[null, null]]),
  row("[1,2,3]", "any(.>2),all(.>0),min,max,reverse", [true, true, 1, 3, [3, 2, 1]]),
  row('[{"a":2},{"a":1},{"a":2}]', "sort_by(.a),unique_by(.a),min_by(.a),max_by(.a)", [[{ a: 1 }, { a: 2 }, { a: 2 }], [{ a: 1 }, { a: 2 }], { a: 1 }, { a: 2 }]),
  row('{"a":1}', 'to_entries | map(.key += "x") | from_entries', [{ ax: 1 }]),
  row('{"a":1}', 'with_entries(.key += "x")', [{ ax: 1 }]),
  row('"123"', "tonumber,tostring,tojson,fromjson", [123, "123", '"123"', 123]),
  row("null", '[("ab"*2),(4.5%2),("a:b"/":"),([1,2,1]-[1])]', [["abab", 0, ["a", "b"], [2]]]),
  row("null", '{a:{b:1,c:2}}*{a:{b:3,d:4}}', [{ a: { b: 3, c: 2, d: 4 } }]),
  row('{"a":1,"b":2}', "(.a,.b) += (1,2)", [{ a: 2, b: 3 }, { a: 3, b: 4 }]),
  row('{"a":null}', ".a //= (false,9)", [{ a: false }, { a: 9 }]),
  row('{"a":1}', ".a //= (1/0)", [], 5),
  row("1", ".a = empty", []),
  row("null", '{("a","b"):(1,2)}', [{ a: 1 }, { a: 2 }, { b: 1 }, { b: 2 }]),
  row("[0,1,2,3]", ".[1,1]|=empty", [[0, 2, 3]]),
  row('{"a":{"b":2}}', "(.a,.a.b)|=empty", [{}]),
  row("1", "if true then . else 0 end", [1]),
  row("1", "if . then 1 else 0 end", [1]),
  row("false", "if . then 1 else . end", [false]),
  row('{"then":1,"else":2,"end":3}', "if .then then .else else .end end", [2]),
  row("[1,2,3]", "(.[0],.[0])|=empty", [[2, 3]]),
  row("[1,2,3]", "(.[0],.[0])|=.+1", [[3, 2, 3]]),
  row("[1,2]", "has(1.5)", [true]),
  row("[1,2]", "[has(-1.5),has(-0.5),has(0.5),has(1.5),has(2.5)]", [[false, true, true, true, false]]),
  row("[1,2]", "[.[-1.5],.[-0.5],.[0.5],.[1.5],.[2.5]]", [[2, 1, 1, 2, null]]),
  row("[1,2]", ".[1.5]=7", [[1, 7]]),
  row("[1,2]", ".[-0.5]=7", [[7, 2]]),
  row("[1,2]", ".[-1.5]=7", [[1, 7]]),
  row("null", '[("b","a") as $x | $x]', [], 3),
];

for (const [index, fixture] of cases.entries()) test(`semantic matrix ${index + 1}: ${fixture.filter}`, async () => {
  const result = await run(["-c", ...fixture.flags ?? [], fixture.filter], fixture.input);
  assert.equal(result.exitCode, fixture.status ?? 0, result.stderr);
  assert.equal(result.stdout, fixture.output);
});

test("prototype keys preserve data without altering host prototypes", async () => {
  const original = Object.getOwnPropertyDescriptors(Object.prototype);
  const input = '{"__proto__":{"polluted":true},"constructor":7,"prototype":8}';
  for (const filter of [".", "to_entries|from_entries", ". + {}", ". * {}", "map_values(.)"]) {
    const result = await run(["-c", filter], input);
    assert.equal(result.stdout, `${input}\n`, filter); assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal((await run(["-c", '--arg', '__proto__', 'safe', '--argjson', 'constructor', '7', '$__proto__,$constructor'])).stdout, '"safe"\n7\n');
  assert.equal((await run(["-c", ".__proto__.polluted=true | [.,{}.polluted]"], "{}")).stdout, '[{"__proto__":{"polluted":true}},null]\n');
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), original);
  assert.equal((await run(["-c", ".polluted"], "{}")).stdout, "null\n");
});

test("integer-like keys retain source/constructor order through output and updates", async () => {
  for (const filter of [".", ".+{}", ".*= {}", "to_entries|from_entries", "map_values(.)", ".a=1"]) {
    const result = await run(["-c", filter], '{"10":10,"2":2,"a":0}');
    assert.equal(result.stdout, `{"10":10,"2":2,"a":${filter === ".a=1" ? 1 : 0}}\n`, result.stderr);
  }
  assert.equal((await run(["-c", '{"10":10,"2":2}'])).stdout, '{"10":10,"2":2}\n');
});

for (const fixture of [
  { filter: ".[range(8):1]", output: ["x", ...Array<string>(7).fill("")], scans: 1 },
  { filter: ".[range(8):0]", output: Array<string>(8).fill(""), scans: 0 },
  { filter: ".[range(8):1]|empty", output: [], scans: 1 },
]) test(`slice generators avoid full materialization: ${fixture.filter}`, async context => {
  const input = "x".repeat(64);
  const budget = new Budget(defaultJqLimits, new AbortController().signal);
  const ast = parse(fixture.filter, new Map(), budget);
  const materialize = context.mock.method(Array, "from");
  const scan = context.mock.method(String.prototype, "codePointAt");
  const output: Json[] = [];
  for await (const value of new Interpreter(budget, new Map()).run(ast, input)) output.push(value);
  assert.deepEqual(output, fixture.output);
  assert.equal(materialize.mock.calls.filter(call => call.arguments[0] === input).length, 0);
  assert.equal(scan.mock.callCount(), fixture.scans);
});

test("slice work charges each scanned code point, including both negative-bound passes", async context => {
  const input = "A😀éZ";
  const cases = [
    { start: 0, end: 1, output: "A", work: 1 },
    { start: 1, end: 2, output: "😀", work: 2 },
    { start: 2, end: null, output: "éZ", work: 2 },
    { start: null, end: null, output: input, work: 0 },
    { start: 3, end: 1, output: "", work: 0 },
    { start: -1, end: -3, output: "", work: 0 },
    { start: -2, end: 0, output: "", work: 0 },
    { start: -2, end: null, output: "́Z", work: 8 },
    { start: 0, end: -1, output: "A😀é", work: 9 },
    { start: -99, end: 99, output: input, work: 10 },
    { start: -1, end: 1, output: "", work: 5 },
    { start: 99, end: null, output: "", work: 5 },
    { start: 99, end: 100, output: "", work: 5 },
    { start: null, end: -99, output: "", work: 5 },
  ];
  const scan = context.mock.method(String.prototype, "codePointAt");
  for (const fixture of cases) {
    const budget = new Budget(defaultJqLimits, new AbortController().signal);
    const step = context.mock.method(budget, "step");
    scan.mock.resetCalls();
    assert.equal(await sliceValue(input, fixture.start, fixture.end, budget), fixture.output);
    assert.equal(step.mock.callCount(), fixture.work, JSON.stringify(fixture));
    assert.equal(scan.mock.callCount(), fixture.work, JSON.stringify(fixture));
  }
});

for (const maxSteps of [4, 6]) test(`slice admits scan work before reading at maxSteps ${maxSteps}`, async context => {
  const budget = new Budget({ ...defaultJqLimits, maxSteps }, new AbortController().signal);
  const scan = context.mock.method(String.prototype, "codePointAt");
  await assert.rejects(async () => sliceValue("A😀éZ", -2, null, budget),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  assert.equal(scan.mock.callCount(), maxSteps);
});

for (const filter of [".[range(8):-1]?|empty", ".[-1:1]?|empty"]) test(`slice hidden work cannot suppress step exhaustion: ${filter}`, async () => {
  const result = await run(["-c", filter], JSON.stringify("x".repeat(64)), { limits: { maxSteps: 40 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jq: maxSteps limit exceeded\n");
});

for (const fixture of [
  { start: 0, end: 1025, size: 1025, reason: false },
  { start: -1, end: null, size: 1025, reason: null },
  { start: -1, end: null, size: 600, reason: false },
]) test(`slice cooperatively aborts within boundary/count passes: ${JSON.stringify(fixture)}`, async context => {
  const controller = new AbortController();
  const budget = new Budget(defaultJqLimits, controller.signal);
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(fixture.reason); });
  const scan = context.mock.method(String.prototype, "codePointAt");
  await assert.rejects(async () => sliceValue("😀".repeat(fixture.size), fixture.start, fixture.end, budget), error => error === fixture.reason);
  assert.equal(checkpoints, 1);
  assert.equal(scan.mock.callCount(), 1023);
});

test("slice pre-abort preserves false/null identity without scanning", async context => {
  const scan = context.mock.method(String.prototype, "codePointAt");
  for (const reason of [false, null]) {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(async () => sliceValue("abc", 0, 1, new Budget(defaultJqLimits, controller.signal)), error => error === reason);
  }
  assert.equal(scan.mock.callCount(), 0);
});

for (const reason of [false, null]) test(`slice optional command preserves cancellation identity: ${reason}`, async context => {
  const controller = new AbortController();
  let checkpoints = 0;
  let writes = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(reason); });
  const scan = context.mock.method(String.prototype, "codePointAt");
  await assert.rejects(run(["-nc", "--arg", "value", "😀".repeat(1100), "($value[0:1100])?"], "", {}, {
    signal: controller.signal,
    stdout: { async write() { writes++; } },
    stderr: { async write() { writes++; } },
  }), error => error === reason);
  assert.equal(checkpoints, 1);
  assert.ok(scan.mock.callCount() > 0 && scan.mock.callCount() < 1100);
  assert.equal(writes, 0);
});

test("slice endpoint matrix preserves code points, clamping, arrays and lone surrogates", async () => {
  const points = ["A", "😀", "e", "́", "Z"];
  const bounds = [null, -99, -6, -5, -4, -2, -1, -0, 0, 1, 2, 4, 5, 6, 99];
  const budget = new Budget(defaultJqLimits, new AbortController().signal);
  const array: Json[] = [0, { nested: true }, 2, 3, 4];
  for (const start of bounds) for (const end of bounds) {
    assert.equal(await sliceValue(points.join(""), start, end, budget), points.slice(start ?? 0, end ?? undefined).join(""));
    const result = await sliceValue(array, start, end, budget);
    assert.deepEqual(result, array.slice(start ?? 0, end ?? undefined));
    assert.notEqual(result, array);
  }
  assert.equal(await sliceValue("A\ud800B", 1, 2, budget), "\ud800");
  assert.equal(await sliceValue("A\udc00B", -2, -1, budget), "\udc00");
  assert.equal(await sliceValue("", null, null, budget), "");
  const shallow = await sliceValue(array, 1, 2, budget) as Json[];
  assert.equal(shallow[0], array[1]);
});

test("slice validates both endpoints before null handling and empty shortcuts", async () => {
  const budget = new Budget(defaultJqLimits, new AbortController().signal);
  for (const value of [null, "", "abc", []]) {
    for (const bound of [1.5, "1", false, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(async () => sliceValue(value, bound, 0, budget),
        error => error instanceof JqError && error.message === "slice start must be an integer or null");
      await assert.rejects(async () => sliceValue(value, 99, bound, budget),
        error => error instanceof JqError && error.message === "slice end must be an integer or null");
    }
  }
  assert.equal(await sliceValue(null, 3, 1, budget), null);
  await assert.rejects(async () => sliceValue(false, 3, 1, budget), { message: "cannot slice boolean" });
});

test("slice generators preserve endpoint/base order, duplicates, lazy errors and output prefixes", async () => {
  const cases = [
    { filter: "(.a,.b)[(0,1):(1,2)]", input: { a: "abc", b: "XYZ" }, values: ["a", "X", "ab", "XY", "", "", "b", "Y"] },
    { filter: ".[(0,0):(1,1)]", input: "abc", values: ["a", "a", "a", "a"] },
    { filter: "first(.[(0,(1/0)):1])", input: "abc", values: ["a"] },
    { filter: "first(.[range(32):1])", input: "abc", values: ["a"] },
    { filter: "limit(0;.[range(32):1])", input: "abc", values: [] },
    { filter: "limit(2;.[range(32):1])", input: "abc", values: ["a", ""] },
    { filter: ".[empty:1]", input: "abc", values: [] },
    { filter: ".[0:empty]", input: "abc", values: [] },
    { filter: ".[range(3;0;-1):1]", input: "abc", values: ["", "", ""] },
    { filter: ".[range(0;3;0):1]", input: "abc", values: [] },
    { filter: ".[1e0:2e0]", input: "A😀éZ", values: ["😀"] },
    { filter: ".[1.5:2]?", input: "abc", values: [] },
    { filter: ".[range(4):]", input: "abcd", values: ["abcd", "bcd", "cd", "d"] },
  ];
  for (const fixture of cases) {
    const result = await run(["-c", fixture.filter], JSON.stringify(fixture.input));
    assert.equal(result.exitCode, 0, fixture.filter);
    assert.equal(result.stderr, "", fixture.filter);
    assert.equal(result.stdout, fixture.values.map(value => `${JSON.stringify(value)}\n`).join(""), fixture.filter);
  }
  for (const limits of [{ maxResults: 3 }, { maxOutputBytes: 7 }]) {
    const result = await run(["-c", ".[range(8):1]"], '"abc"', { limits });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, "maxResults" in limits ? '"a"\n""\n""\n' : '"a"\n""\n');
    assert.equal(result.stderr, `jq: ${Object.keys(limits)[0]} limit exceeded\n`);
  }
});
