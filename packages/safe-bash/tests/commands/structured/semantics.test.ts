import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
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

test("native jq oracle checks supported matrix (version reported)", async context => {
  const version = spawnSync("jq", ["--version"], { encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
  if (version.error || version.status !== 0) { context.skip("native jq is unavailable"); return; }
  context.diagnostic(`oracle ${version.stdout.trim()}; ${cases.length - 1} supported cases; timeout 2s/case`);
  for (const fixture of cases.filter(fixture => fixture.status !== 3)) {
    const result = spawnSync("jq", ["-c", ...fixture.flags ?? [], fixture.filter], { input: fixture.input, encoding: "utf8", timeout: 2000, maxBuffer: 512 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, fixture.status ?? 0, `${fixture.filter}: ${result.stderr}`);
    assert.equal(result.stdout, fixture.output, fixture.filter);
  }
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
