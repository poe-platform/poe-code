import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { RustWasmBash, createRustWasmBash } from "./index.js";

test("text utilities consume stdin once across operands and shell commands", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, expected] of [
      ["wc -c - -", "      4 -\n      0 -\n      4 total\n"],
      ["sort - -", "a\nb\n"], ["uniq", "b\na\n"], ["tac - -", "a\nb\n"],
      ["cut -f1 - -", "b\na\n"], ["tr a x", "b\nx\n"], ["rev", "b\na\n"],
      ["fold - -", "b\na\n"], ["fmt - -", "b a\n"], ["nl - -", "     1\tb\n     2\ta\n"],
      ["expand - -", "b\na\n"], ["unexpand - -", "b\na\n"],
    ]) {
      const r = await bash.exec(cmd + "; cat", { stdin: "b\na\n" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], cmd);
    }
  } finally { bash.dispose(); }
});

test("cat, head and tail advance the shared stdin cursor only when they read", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [script, input, expected] of [
      ["head -qc2 - -; echo; cat", "abcdef", "abcd\nef"],
      ["head -qzn1 - -; echo; cat", "a\0b\0c", "a\0b\0\nc"],
      ["head -n-1; cat", "a\nb\nc\n", "a\nb\n"],
      ["tail -qc2 - -; cat", "abcdef", "ef"],
      ["cat - -; cat", "abcdef", "abcdef"],
      ["cat --invalid 2>/dev/null; cat", "abcdef", "abcdef"],
      ["head -c0; head -c1 </dev/null; cat", "abc", "abc"],
    ]) {
      const result = await bash.exec(script, { stdin: input });
      assert.deepEqual([result.stdout, result.exitCode], [expected, 0], script);
    }
    const split = await bash.exec("head -c1; echo; cat", { stdin: "é" });
    assert.deepEqual([...split.stdoutBytes], [0xc3, 10, 0xa9]);
  } finally { bash.dispose(); }
});

test("a rejected beforeExec hook leaves stdin untouched", async () => {
  const bash = new RustWasmBash(), reason = new Error("hook refused execution");
  let opened = 0;
  const stdin = { [Symbol.asyncIterator]() { opened++; return { async next() { return { done: true }; } }; } };
  try {
    await assert.rejects(bash.exec("cat", { stdin, hooks: { async beforeExec() { throw reason; } } }), e => e === reason);
    assert.equal(opened, 0);
  } finally { bash.dispose(); }
});

test("abort closes held async stdin once without waiting for the producer", async () => {
  const bash = new RustWasmBash(), controller = new AbortController();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let returns = 0, settled = false;
  const source = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return release.promise; },
    async return() { returns++; throw new Error("late cleanup failure"); },
  }; } };
  const reason = { stop: true };
  const result = assert.rejects(bash.exec("cat", { stdin: source, signal: controller.signal }), e => e === reason)
    .then(() => { settled = true; });
  try {
    await entered.promise;
    controller.abort(reason);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([settled, returns], [true, 1]);
  } finally {
    release.resolve({ done: true });
    await result;
    bash.dispose();
  }
});

test("async stdin preserves borrowed bytes and stops pulling after cancellation", async () => {
  const bash = new RustWasmBash();
  try {
    const source = { async *[Symbol.asyncIterator]() {
      const chunk = Buffer.alloc(2);
      for (const b of [0, 128, 255]) {
        chunk.fill(b);
        yield chunk.subarray(1);
      }
    } };
    const result = await bash.exec("cat", { stdin: source });
    assert.deepEqual([...result.stdoutBytes], [0, 128, 255]);
    const controller = new AbortController();
    const reason = { cancelled: true };
    let reads = 0, closes = 0;
    const cancelled = { async *[Symbol.asyncIterator]() {
      try {
        reads++; yield Uint8Array.of(1);
        controller.abort(reason);
        reads++; yield Uint8Array.of(2);
        reads++; yield Uint8Array.of(3);
      } finally { closes++; }
    } };
    await assert.rejects(bash.exec("cat", { stdin: cancelled, signal: controller.signal }), e => e === reason);
    assert.deepEqual([reads, closes], [2, 1]);
  } finally { bash.dispose(); }
});

test("jq accepts if as an unquoted object key beside conditional values", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, expected] of [
      ["{if:if true then 1 else 3 end,end:4}", '{"if":1,"end":4}\n'],
      ['{"if":"yes","end":2} | {if,end}', '{"if":"yes","end":2}\n'],
      ["{if: (1,2), end: 3}", '{"if":1,"end":3}\n{"if":2,"end":3}\n'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq field access visits every base and respects optional and quoted keys", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, status, stdout, stderr] of [
      ["{x:1} | .x", 0, "1\n", ""],
      ["{\"if\":1} | .if", 0, "1\n", ""],
      ["({a:1},error(\"late\")).a", 5, "1\n", "jq: error (at <unknown>): late\n"],
      ["first(({a:1},error(\"late\")).a)", 0, "1\n", ""],
      ["[{a:1},0,{a:3}] | .[].a?", 0, "1\n", ""],
      ["[{a:1},0,{a:3}] | .[].a", 5, "1\n", "jq: error (at <unknown>): Cannot index number with string \"a\"\n"],
      ["{\"#text\":4} | .\"+content\"", 0, "null\n", ""],
      ["{\"@x\":2} | .\"+@x\"", 0, "null\n", ""],
      ["{\"a.b\":5} | .\"a.b\"", 0, "5\n", ""],
      ["{\"k1\":4,\"k2\":7} | .\"k\\((1,2))\"", 0, "4\n7\n", ""],
      ["[5] | .longlonglonglonglonglonglonglonglong", 5, "", "jq: error (at <unknown>): Cannot index array with string\n"],
      ["0 | .\"a\\\"b\"", 5, "", "jq: error (at <unknown>): Cannot index number with string \"a\\\"b\"\n"],
      ["[{\"x\":3}] as $r | $r[0].x", 0, "3\n", ""],
      ["def f: {v:1},error(\"late\"); first(f.v)", 0, "1\n", ""],
      ["[{a:1},{a:2}] | (.[]).a", 0, "1\n2\n", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, stdout, stderr], filter);
    }
  } finally { bash.dispose(); }
});

test("jq evaluates bracket indexes and slice bounds before each base", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, status, stdout, stderr] of [
      ["([7,8],[5,6])[(1,0)]", 0, "8\n6\n7\n5\n", ""],
      [".[(0,error(\"late\"))]", 5, "null\n", "jq: error (at <unknown>): late\n"],
      [".[false]", 5, "", "jq: error (at <unknown>): Cannot index null with boolean\n"],
      ["[4,5][1]", 0, "5\n", ""],
      ["[1,2,1][[1]]", 0, "[0,2]\n", ""],
      ["[1,2,3][{start:1,end:null}]", 0, "[2,3]\n", ""],
      ["[1,2,3][(0,1):(1,3)]", 0, "[1]\n[1,2,3]\n[]\n[2,3]\n", ""],
      ["\"𝄞ab\" | .[-2:]", 0, "\"ab\"\n", ""],
      ["{x:[5,6]} | .x[(1,0)]", 0, "6\n5\n", ""],
      ["first(([1], error(\"late\"))[0])", 0, "1\n", ""],
      ["[.,.][halt]", 0, "", ""],
      ["[1,2] | .[false]?", 0, "", ""],
      ["[1,2] | .[(0,error(\"late\"))]?", 0, "1\n", ""],
      ["\"ab\" | .[0]", 5, "", "jq: error (at <unknown>): Cannot index string with number\n"],
      ["null | .[1:false]", 5, "", "jq: error (at <unknown>): slice end must be a finite number or null\n"],
      ["{\"a\":1,\"b\":2} | .[\"a\",\"b\"]", 0, "1\n2\n", ""],
      ["[1,2] as $a | $a[0:1]", 0, "[1]\n", ""],
      ["[0,1,2] | .[nan:1.5]", 0, "[0,1]\n", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, stdout, stderr], filter);
    }
  } finally { bash.dispose(); }
});

test("jq halt exits the program across catches and preserves prior output", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, status, stdout, stderr] of [
      ["1,halt,2", 0, "1\n", ""],
      ["halt()", 0, "", ""],
      ["halt_error()", 5, "", ""],
      ["try halt catch 9", 0, "", ""],
      ["try halt_error(7) catch .", 7, "", ""],
      ['"problem" | halt_error', 5, "", "problem"],
      ["{a:2} | halt_error(259.9)", 3, "", '{"a":2}\n'],
      ['"x" | halt_error(-2)', 0, "", "x"],
      ["false | halt_error(empty), 1", 0, "1\n", ""],
      ['"a" | try halt_error(false) catch .', 0, JSON.stringify('string ("a") halt_error/1: number required') + "\n", ""],
      ['null | halt_error((6,error("never")))', 6, "", ""],
      ["try error(nan) catch isnan", 0, "true\n", ""],
      ['try error((1,error("later"))) catch .', 0, "1\n", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, stdout, stderr], filter);
    }
    const stopped = await bash.exec("jq -c '.,halt' <<< $'1\\n2'");
    assert.deepEqual([stopped.exitCode, stopped.stdout, stopped.stderr], [0, "1\n", ""]);
  } finally { bash.dispose(); }
});

test("jq searches byte offsets and overlapping subsequences for every pattern", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['"ééé" | indices("éé")', "[0,2]\n"],
      ['"𝄞a𝄞" | index(("a","𝄞"))', "4\n0\n"],
      ["[1,1,1] | rindex(([1,1],[2]))", "1\nnull\n"],
      ["[1.0,1.00,1] | indices([1,1])", "[0,1]\n"],
      ['"abc" | indices(false)', "", "Cannot index string with boolean"],
      ['{"x":[1,2]} | indices("x"),rindex("x")', "[1,2]\n2\n"],
      ['"a" | first(indices(("a",error("late"))))', "[0]\n"],
      ["[7,8,9] | indices({start:1,end:null})", "[8,9]\n"],
      ['"abc" | indices({start:nan,end:2})', '"ab"\n'],
      ["[1] | indices(empty)", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq iteration emits each object or array item until an error or early stop", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['([1,2],error("late"))[]', "1\n2\n", "late"],
      ['first(([1],error("late"))[])', "1\n"],
      ['({x:1,y:2},[3])[]', "1\n2\n3\n"],
      ["(true,[3])[]?", ""],
      ["[[1],false,[2]] | .[][]?", "1\n"],
      ["0 | .[ ]", "", "Cannot iterate over number (0)"],
      ['"ББББББББББ" | .[]', "", 'Cannot iterate over string ("БББББ...)'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq binds function value parameters as nested streams in the caller's scope", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['def f($x): $x; f((1,error("stop")))', "1\n", "stop"],
      ['def f($a;$b): [$a,$b]; f((1,2);inputs)', "[1,7]\n[1,8]\n"],
      ['def f($a;$b): [$a,$b]; f(empty;error("stop"))', ""],
      ['def f($a;$b): [$a,$b]; first(f((1,2);(3,error("late"))))', "[1,3]\n"],
      ['def f($a;g): $a | g; 4 as $x | f((3,4);.+$x)', "7\n8\n"],
      ['def f($x): .[$x]; {"a":1,"b":2} | (f(("a","b")))=3', '{"a":3,"b":3}\n'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`, { stdin: "7\n8\n" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq getpath and setpath visit each candidate and validate it against the input", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['setpath((["x"],["y"]);(1,2))', '{"x":1}\n{"y":1}\n{"x":2}\n{"y":2}\n'],
      ['setpath(error("path");empty)', ""],
      ['setpath("x";0)', "", "Path must be specified as an array"],
      ['try setpath([1e100,false];1) catch .', '"Cannot index null with boolean"\n'],
      ['setpath([{"__slice":[0,1]}];[])', "", "Cannot index null with object"],
      ['first(setpath((["x"],error("later"));1))', '{"x":1}\n'],
      ['setpath((["x"],error("stop"));42)', '{"x":42}\n', "stop"],
      ['{"a":3} | getpath((["a"],[],["x"]))', '3\n{"a":3}\nnull\n'],
      ["getpath(4)", "", "Path must be specified as an array"],
      ["[0] | getpath(([0],[false]))", "0\n", "Cannot index array with boolean"],
      ['"𝄞ab" | getpath([{start:-2,end:null}])', '"ab"\n'],
      ["[2,3,4] | getpath([{start:0.1,end:1.1}])", "[2,3]\n"],
      ["[] | getpath([{}])", "", "Array/string slice indices must be integers"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq select, negation and optional filters preserve intermediate results", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ["7 | select((false,true,true))", "7\n7\n"],
      ['5 | select((true,error("stop")))', "5\n", "stop"],
      ['first(select((true,error("stop"))))', "null\n"],
      ["-((2,true))", "-2\n", "negation requires a number"],
      ['(-(2,error("stop")))?', "-2\n"],
      ['(1,error("stop"))?', "1\n"],
      ['(1,2)? | error("outside")', "", "outside"],
    ]) {
      const r = await bash.exec(`jq -nc -- '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("yq properties retain numeric path components as keys and replace scalar parents", async () => {
  const bash = new RustWasmBash({ files: {"/workspace/app.properties": "a=1\na.1=b\na.0=x\n0=root\n"} });
  try {
    const r = await bash.exec("yq -p props -o json -I0 . app.properties");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, '{"0":"root","a":{"0":"x","1":"b"}}\n', ""]);
  } finally { bash.dispose(); }
});

test("jq validates array indexes and slice replacements before growing a path", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, message] of [
      ["[1] | .[-3]=9", "array index out of bounds"],
      ["2 | .x=4", 'Cannot index number with string "x"'],
      ["{} | .[2]=5", "Cannot index object with number"],
      ["[1,2] | .[0:1]=3", "slice assignment requires an array value"],
      ["setpath([false];42)", "Cannot index null with boolean"],
      ["setpath([-1];9)", "Out of bounds negative array index"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", `jq: error (at <unknown>): ${message}\n`], filter);
    }
    const limit = await bash.exec("jq -nc 'try setpath([1e100];42) catch 5'");
    assert.deepEqual([limit.exitCode, limit.stdout, limit.stderr], [5, "", "jq: maxCollectionSize limit exceeded\n"]);
  } finally { bash.dispose(); }
});

test("jq assignments use one right-hand value for every path and delete empty updates", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, values] of [
      ["{} | (.a,.b) = (1,2)", [{a:1,b:1},{a:2,b:2}]],
      ["{} | (.a,.b) = first(inputs)", [{a:1,b:1}]],
      ["{x:3} | .x += (2,4)", [{x:5},{x:7}]],
      ["{x:5} | .x //= (1,2)", [{x:5},{x:5}]],
      ["{x:5} | .x = empty", []],
      ["{x:5} | .x |= empty", [{}]],
      ["[0,1,2,3,4] | (.[1],.[3],.[1]) |= empty", [[0,2,4]]],
      ['{x:42} | .x |= (1,error("late"))', [{x:1}]],
      ["first(.x = inputs),inputs", [{x:1},2,3]],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, values.map(v => JSON.stringify(v) + "\n").join(""), ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq labels stop the right generator and expose the break value to catch", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, stdout] of [
      ["-nc 'label $x | [(1,break $x)],2'", ""],
      ["-nc 'label $outer | (label $out | 1,break $outer),2'", "1\n"],
      ["-nc '[label $x | (label $x | 1,break $x),2]'", "[1,2]\n"],
      ["-c 'label $x | try break $x catch .__jq' <<< '1 2 3'", "0\n1\n2\n"],
      ["-nc 'label $x | try break $x catch error(.)'", ""],
      ["-nc 'label $x | 1,error({__jq:0}),2'", "1\n"],
      ["-nc '[first(label $x | inputs),inputs]' <<< '1 2 3'", "[1,2,3]\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], args);
    }
    const err = await bash.exec(`jq -nc 'label $x | 1,error("bad")'`);
    assert.deepEqual([err.exitCode, err.stdout, err.stderr], [5, "1\n", "jq: error (at <unknown>): bad\n"]);
  } finally { bash.dispose(); }
});

test("jq reduce and foreach interleave their initial, source and update streams", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["[reduce (1,2) as $x (0; (.+$x, .+$x+10))]", "[23]\n"],
      ["[foreach (1,2) as $x (0; (.+$x, .+$x+10))]", "[1,11,13,23]\n"],
      ["7 | [reduce . as $x ((0,5); $x)]", "[7,null]\n"],
      ["7 | [foreach . as $x ((0,5); $x)]", "[7,7]\n"],
      ["[reduce inputs as $x (empty; .),inputs]", "[1,2,3]\n"],
      ["[first(foreach inputs as $x (0; $x)),inputs]", "[1,2,3]\n"],
      ["[foreach (1,2) as $x (0; empty; 42)]", "[]\n"],
      ["reduce range(3) as $x (first(range(7;9)); .+$x)", "10\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    const r = await bash.exec(`jq -nc 'foreach (1,error("bad")) as $x (0; $x)'`);
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "1\n", "jq: error (at <unknown>): bad\n"]);
  } finally { bash.dispose(); }
});

test("jq binary operators visit every operand in order and short-circuit unused filters", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["[(10,20) - (1,2)]", "[9,19,8,18]\n"],
      ["[(1,2) == (2,1)]", "[false,true,true,false]\n"],
      ["[first(inputs) - first(inputs),inputs]", "[1,3]\n"],
      ['[false and error("x"),true or error("y")]', "[false,true]\n"],
      ["[(false,true) and (true,false)]", "[false,true,false]\n"],
      ['first((1,error("late")) // 3)', "1\n"],
      ['try (error("x") // 2) catch .', '"x"\n'],
      ['first((1,error("late")) + 2)', "3\n"],
      ["[.a // .b=5]", '[{"b":5}]\n'],
      ["(1,2)+empty", ""],
      ["[1+-2,2*-3,1e-2+2e-2]", "[-1,-6,0.03]\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq parses arguments, file variables and string conversions with its input grammar", async () => {
  const bash = new RustWasmBash({ files: {"/workspace/bad": "[1,]", "/workspace/-": "1 2"} });
  try {
    for (const [args, code, stdout, stderr] of [
      ["-nc --argjson x '[1,]' '$x'", 2, "", "jq: invalid JSON for --argjson x\n"],
      ["-nc --jsonargs '$ARGS.positional' '[1,]'", 2, "", "jq: invalid JSON text passed to --jsonargs\n"],
      ["-nc --argjson x '+.5' '$x'", 0, "0.5\n", ""],
      ["-nc --slurpfile x bad '$x'", 2, "", "jq: Bad JSON in --slurpfile x bad: parse error: Expected another array element at line 1, column 4\n"],
      ["-nc --slurpfile x - '$x' <<< 99", 0, "[1,2]\n", ""],
      ["-Rsc fromjson bad", 5, "", "jq: error (at bad:0): Expected another array element at line 1, column 4 (while parsing '[1,]')\n"],
      [`-nc '"1 2 ]" | fromjson'`, 5, "", "jq: error (at <unknown>): Unexpected extra JSON values (while parsing '1 2 ]')\n"],
      [`-nc '"true" | tonumber'`, 5, "", 'jq: error (at <unknown>): string ("true") cannot be parsed as a number\n'],
      ["-nc '42 | fromjson'", 5, "", "jq: error (at <unknown>): number (42) only strings can be parsed\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], args);
    }
  } finally { bash.dispose(); }
});

test("jq preserves numeric literals independently when their doubles are equal", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [command, stdout] of [
      ["jq -c . <<< '[9007199254740992,9007199254740993,1.00,1e300,1e-999,-0.0]'", "[9007199254740992,9007199254740993,1.00,1E+300,1E-999,-0.0]\n"],
      ["jq -nc '[9007199254740993 == 9007199254740992,9007199254740993 > 9007199254740992,1e-999 > 0,1e-999 == 0]'", "[false,true,true,false]\n"],
      ["jq -nc '[1e20+0,1e-8+0,-1.200,-0.0]'", "[1e+20,1e-08,-1.2,-0]\n"],
      ["jq -nc '[range(1.0;3.0),limit(2.0;range(3))]'", "[1.0,2,0,1]\n"],
      ["jq -nc '[1.00|.,tonumber,abs,-.,.+0]'", "[1.00,1.00,1,-1,1]\n"],
      ["jq -nc '[[1.00]|add]'", "[1.00]\n"],
    ]) {
      const r = await bash.exec(command);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], command);
    }
  } finally { bash.dispose(); }
});

test("jq selects stream results for each nth argument and returns null for last(empty)", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["nth((0,2);range(4))", "0\n2\n"],
      ["[nth((0,1);inputs),inputs]", "[1,3,4]\n"],
      ["[1,2,3] | nth((-1,0.5,9))", "3\n1\nnull\n"],
      ['{x:42} | nth(("x","missing"))', "42\nnull\n"],
      ["nth(1.0;range(3))", "1\n"],
      ["last(empty)", "null\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3 4'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    for (const [filter, message] of [
      ["nth(-1;empty)", "nth doesn't support negative indices"],
      ["true | nth(2)", "Cannot index boolean with number"],
      ['[] | nth("x")', 'Cannot index array with string "x"'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", `jq: error (at <unknown>): ${message}\n`], filter);
    }
  } finally { bash.dispose(); }
});

test("jq emits every combination of object fields in order and replaces duplicate keys", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, values] of [
      ["{x:(1,2),y:(3,4)}", [{x:1,y:3}, {x:1,y:4}, {x:2,y:3}, {x:2,y:4}]],
      ["{x:empty}", []],
      ["{x:1,y:2,x:3}", [{x:3,y:2}]],
      ['{("a","b"):first(inputs)}', [{a:1}, {b:2}]],
      ['"key" as $x | {$x, $x:2}', [{x:"key",key:2}]],
      ['{"a\\tb":1, "x\\(1)":2}', [{"a\tb":1,x1:2}]],
      ['first({x:(1,error("late"))})', [{x:1}]],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, values.map(v => JSON.stringify(v) + "\n").join(""), ""], filter);
    }
    const r = await bash.exec("jq -nc '{(1):2}'");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", "jq: error (at <unknown>): object keys must be strings\n"]);
  } finally { bash.dispose(); }
});

test("jq ranges and limits stream numeric arguments and stop when their consumer stops", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["[range(0.5;3)]", "[0.5,1.5,2.5]\n"],
      ["[range((0,2);(2,4);2)]", "[0,0,2,2]\n"],
      ["[range(0;3;(1,2))]", "[0,1,2,0,2]\n"],
      ["[limit((1,2);range(4))]", "[0,0,1]\n"],
      ["[first(limit(100000000;range(1000000000)))]", "[0]\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    for (const [filter, message] of [
      ["limit(-1;1)", "limit requires a nonnegative integer"],
      ["limit(0.5;1)", "limit requires a nonnegative integer"],
      ['range("2")', "range requires numbers"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", `jq: error (at <unknown>): ${message}\n`]);
    }
  } finally { bash.dispose(); }
});

test("jq stops input generators after producing enough output and preserves results before errors", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/items": "1 2 3 4\n", "/workspace/good": "7 8" } });
  try {
    for (const [filter, stdout] of [
      ["[limit(1; inputs | select(.>2)),inputs]", "[3,4]\n"],
      ["def filtered: inputs|select(.>2); [first(filtered),inputs]", "[3,4]\n"],
      ["def by(f): inputs|select(f); [first(by(.>2)),inputs]", "[3,4]\n"],
      ["def f($x): $x; f(2)+f(3)", "5\n"],
      ["[limit(1;[inputs]),inputs]", "[[1,2,3,4]]\n"],
      ["(inputs | select(. > 1)) as $x | [$x,first(inputs)]", "[2,3]\n[4]\n"],
      ['try (1,error("bad")) catch "caught"', '1\n"caught"\n'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' items`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    const error = await bash.exec(`jq -nc '1,error("bad")'`);
    assert.deepEqual([error.exitCode, error.stdout, error.stderr], [5, "1\n", "jq: error (at <unknown>): bad\n"]);
    const missing = await bash.exec("jq -nc inputs good missing");
    assert.deepEqual([missing.exitCode, missing.stdout, missing.stderr], [2, "7\n", "jq: ENOENT: no such file or directory, readStream '/workspace/missing'\n"]);
  } finally { bash.dispose(); }
});

test("jq reports runtime errors at the input record and resumes at the next value", async () => {
  const bash = new RustWasmBash({ files: {
    "/workspace/a": "1\n2\n", "/workspace/b": "3 4", "/workspace/x": "1 2 3\n", "/workspace/bad": "oops",
  } });
  try {
    for (const [args, code, stdout, stderr] of [
      ["-c 'error(\"bad\")' a b", 5, "", ["a:1", "a:2", "b:0", "b:0"].map(p => `jq: error (at ${p}): bad\n`).join("")],
      ["-c 'if .==2 then error({a:3}) else . end' x", 0, "1\n3\n", 'jq: error (at x:1): {"a":3}\n'],
      ["-ce 'if .==2 then error(\"bad\") else empty end' x", 4, "", "jq: error (at x:1): bad\n"],
      ["-nc '[inputs]' bad", 5, "", "jq: error (at bad:0): parse error: Invalid numeric literal at EOF at line 1, column 4\n"],
      ["-nc 'try inputs catch .' bad", 0, '"parse error: Invalid numeric literal at EOF at line 1, column 4"\n', ""],
      [String.raw`-nc 'error("a\rb\u001b")'`, 5, "", "jq: error (at <unknown>): a\\rb\\033\n"],
      ["-c 'error' a missing", 2, "", "jq: error (at a:1): 1\njq: error (at a:2): 2\njq: ENOENT: no such file or directory, readStream '/workspace/missing'\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], args);
    }
  } finally { bash.dispose(); }
});

test("jq resynchronizes JSON sequences at record separators and preserves warnings", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [flags, text, stdout, stderr] of [
      ["", "123\n", "", ""],
      ["", "noise\n\x1e1\n\x1e2", "\x1e1\n", "jq: ignoring parse error: Potentially truncated top-level numeric value at EOF at line 3, column 2\n"],
      ["", "\x1e1\x1e[2]\n", "\x1e[2]\n", "jq: ignoring parse error: Potentially truncated top-level numeric value at line 1, column 3\n"],
      ["", "\x1e[1,\x1e3\n", "\x1e3\n", ""],
      ["", "\x1e[1\x1e3\n", "\x1e3\n", "jq: ignoring parse error: Truncated value at line 1, column 4\n"],
      ["", "\x1ebad\n\x1e{}\n", "\x1e{}\n", "jq: ignoring parse error: Invalid numeric literal at line 2, column 0 (need RS to resync)\n"],
      ["--stream-errors", "\x1e[1,]\n\x1e[2]\n", '\x1e[[0],1]\n\x1e["Expected another array element at line 1, column 5",[1]]\n\x1e[[0],2]\n\x1e[[0]]\n', ""],
    ]) {
      await bash.fs.writeFile("/workspace/data", new TextEncoder().encode(text));
      const r = await bash.exec(`jq -c --seq ${flags} . data`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, stderr], text);
    }
  } finally { bash.dispose(); }
});

test("jq emits JSON stream events before a container closes and reports parse errors at byte positions", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/prefix": "[10," } });
  try {
    const first = await bash.exec("jq -cn --stream 'first(inputs)' prefix missing");
    assert.deepEqual([first.exitCode, first.stdout, first.stderr], [0, "[[0],10]\n", ""]);
    for (const [flags, text, code, stdout, stderr] of [
      ["", "1 bad\n", 5, "1\n", "jq: parse error: Invalid numeric literal at line 2, column 0\n"],
      ["", "[1,]", 5, "", "jq: parse error: Expected another array element at line 1, column 4\n"],
      ["", '{"x":}', 5, "", "jq: parse error: Unmatched '}' at line 1, column 6\n"],
      ["", '"é\\q"', 5, "", "jq: parse error: Invalid escape at line 1, column 6\n"],
      ["", "[1", 5, "", "jq: parse error: Unfinished JSON term at EOF at line 1, column 2\n"],
      ["", "\ufeff2", 0, "2\n", ""],
      ["", "\ufeffbad", 5, "", "jq: parse error: Invalid numeric literal at EOF at line 1, column 3\n"],
      ["--stream", '{"x":[1,2],"x":3}', 0, '[["x",0],1]\n[["x",1],2]\n[["x",1]]\n[["x"],3]\n[["x"]]\n', ""],
      ["--stream-errors", "[1,]\n[2]\n", 0, '[[0],1]\n["Expected another array element at line 1, column 4",[1]]\n[[0],2]\n[[0]]\n', ""],
    ]) {
      await bash.fs.writeFile("/workspace/data", new TextEncoder().encode(text));
      const r = await bash.exec(`jq -c ${flags} . data`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], text);
    }
  } finally { bash.dispose(); }
});

test("jq opens input files on demand and shares a cursor with inputs", async () => {
  const bash = new RustWasmBash({ files: {
    "/workspace/numbers": "10 20", "/workspace/start": "1", "/workspace/end": "2\n",
    "/workspace/a": "a\r\nb", "/workspace/b": "c\n",
  } });
  try {
    for (const [args, stdout] of [
      ["-nc 'if false then inputs else 5 end' missing", "5\n"],
      ["-nc 'def unused: inputs; 1' missing", "1\n"],
      ["-nc 'limit(0; inputs)' missing", ""],
      ["-nc 'first(inputs)' numbers missing", "10\n"],
      ["-c . start end", "12\n"],
      ["-Rc . a b", '"a\\r"\n"bc"\n'],
      ["-nc '[first(inputs),inputs]' - - <<< '1 2'", "[1,2]\n"],
      ["-nsc '[inputs]' </dev/null", "[[]]\n"],
      ["-nRsc '[inputs]' </dev/null", '[""]\n'],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], args);
    }
    for (const [args, stdout] of [
      [". numbers missing", "10\n"],
      ["-nc 'try inputs catch 3' missing", ""],
      ["-nc 'first(inputs)' start missing", ""],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, stdout, "jq: ENOENT: no such file or directory, readStream '/workspace/missing'\n"], args);
    }
  } finally { bash.dispose(); }
});

test("jq evaluates each condition result and emits nothing for an empty condition", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["if (true,first(inputs)) then first(inputs) else 0 end", "1\n3\n"],
      ['first(if (true,error("late")) then 7 else 0 end)', "7\n"],
      ["if empty then 1 else 2 end", ""],
      ['if (true,false,true) then "a" elif (false,true) then "b" else "c" end', '"a"\n"c"\n"b"\n"a"\n'],
      ["if (null,true,false) then 9 end", "null\n9\nnull\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""]);
    }
  } finally { bash.dispose(); }
});

test("jq keeps the first named argument and skips duplicate file operands", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/values": "42" } });
  try {
    for (const [args, expected] of [
      ["--arg x first --argjson x 2", "first"],
      ["--arg x first --rawfile x missing", "first"],
      ["--slurpfile x values --arg x second", [42]],
    ]) {
      const r = await bash.exec(`jq -nc ${args} '[$x,$ARGS.named]'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, JSON.stringify([expected, { x: expected }]) + "\n", ""]);
    }
    const r = await bash.exec("jq -nc --arg x first --argjson x nope '$x'");
    assert.deepEqual([r.exitCode, r.stderr], [2, "jq: invalid JSON for --argjson x\n"]);
  } finally { bash.dispose(); }
});

test("jq rejects invalid UTF-8 in program files before opening data files", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/filter.jq": Uint8Array.of(34, 255, 34) } });
  try {
    const r = await bash.exec("jq -f filter.jq missing");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [3, "", "jq: program file is not valid UTF-8\n"]);
  } finally { bash.dispose(); }
});

test("jq emits exact JSON bytes for ASCII, indentation, color, and sequence options", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, expected] of [
      [String.raw`-nc '["\b","\f","\u007f"]'`, String.raw`["\b","\f","\u007f"]` + "\n"],
      [`-nrc --ascii-output '{"é":"😀"}'`, String.raw`{"\u00e9":"\ud83d\ude00"}` + "\n"],
      [String.raw`-na --raw-output0 '"\u0000"'`, '"\\u0000"\0'],
      [`-nc --indent 1 '{a:[1]}'`, '{\n "a": [\n  1\n ]\n}\n'],
      [`-nc --tab '{a:[]}'`, '{\n\t"a": []\n}\n'],
      [`-ncC '{a:[null]}'`, '\x1b[1;39m{\x1b[0m\x1b[1;34m"a"\x1b[0m\x1b[1;39m:\x1b[0m\x1b[1;39m[\x1b[0;90mnull\x1b[0m\x1b[1;39m\x1b[1;39m]\x1b[0m\x1b[1;39m\x1b[1;39m}\x1b[0m\n'],
      [`-ncMC '{a:[null]}'`, '{"a":[null]}\n'],
      [`-nr --seq '"abc",1'`, "abc\n\x1e1\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], args);
    }
  } finally { bash.dispose(); }
});

test("jq reports undefined function signatures in unused definitions and branches", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, errors] of [
      ["if false then foo else bar(baz) end", [["foo/0", 14], ["bar/1", 23]]],
      ["def a: missing1; def b: missing2; missing3", [["missing2/0", 24], ["missing1/0", 7], ["missing3/0", 34]]],
      ["def f($x): $x; f(1;2)", [["f/2", 15]]],
      ["def unused: later; def later: 1; .", [["later/0", 12]]],
      ["(def local: 1; local), local", [["local/0", 23]]],
      ["empty | length(.)", [["length/1", 8]]],
    ]) {
      const result = await bash.exec(`jq '${filter}' /missing`);
      const diagnostic = errors.map(([call, offset]) =>
        `jq: error: ${call} is not defined at <top-level>, line 1:\n${filter}${" ".repeat(offset)}\n`
      ).join("") + `jq: ${errors.length} compile error${errors.length > 1 ? "s" : ""}\n`;
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [3, "", diagnostic]);
    }
    const r = await bash.exec(`jq -nc 'def f: 1; def apply(f): f; [f(), apply(f)]'`);
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "[1,1]\n", ""]);
  } finally { bash.dispose(); }
});

test("jq compiles nested modules in their own scope before opening inputs", async () => {
  const bash = new RustWasmBash({ files: {
    "/workspace/lib/base.jq": 'def pair($a;$b): [$a,$b]; def tag: "m::tag";',
    "/workspace/lib/top.jq": 'include "base"; def run: pair(tag;42);',
    "/workspace/lib/loop.jq": 'include "loop";',
    "/workspace/lib/bad.jq": 'def f: $lost;',
    "/workspace/cwd.jq": 'def ignored: 1;',
  } });
  try {
    const result = await bash.exec(`jq -Llib -nc 'import "top" as m; [m::run,"m::tag",m::pair(3;4)]'`);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, '[["m::tag",42],"m::tag",[3,4]]\n', ""]);
    for (const [filter, diagnostic] of [
      ['$lost', 'undefined variable $lost at offset 5'],
      ['include "cwd"; .', 'module not found: cwd'],
      ['include "bad"; .', 'undefined variable $lost at offset 12'],
      ['include "../cwd"; .', 'invalid module path'],
      ['include "loop"; .', 'module dependency cycle: loop'],
    ]) {
      const r = await bash.exec(`jq -Llib '${filter}' /missing`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [3, "", `jq: ${diagnostic}\n`]);
    }
  } finally { bash.dispose(); }
});

test("jq validates complete string segments and decodes paired Unicode escapes", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, diagnostic] of [
      [String.raw`"abc\q"`, "invalid string at offset 0"],
      [String.raw`"\ud800"`, "invalid string at offset 0"],
      [String.raw`"\udc00"`, "invalid string at offset 0"],
      [String.raw`"x\(2)y\q"`, "invalid string at offset 5"],
      ['"abc' + "\\", "unterminated string or interpolation at offset 6"],
      ["[", "error: syntax error, unexpected end of file (Unix shell quoting issues?) at <top-level>, line 1:\n[\njq: 1 compile error"],
    ]) {
      const result = await bash.exec(`jq '${filter}' /missing-input`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [3, "", `jq: ${diagnostic}\n`]);
    }
    const result = await bash.exec(String.raw`jq -nc '["\ud83d\ude00","x\(2)\ud83d\ude00\b\f"]'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["😀", "x2😀\b\f"]);
  } finally { bash.dispose(); }
});

test("jq checks variable scope before reading input or evaluating branches", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, name, offset] of [
      ["$missing", "missing", 8], ["empty | $missing", "missing", 16], ["if false then $missing else 3 end", "missing", 23],
      ["(. as $x | $x), $x", "x", 18], ["def f($x): $x; $x", "x", 17],
      ["reduce .[] as $x ($x; .)", "x", 20], ['"😀\\($no)"', "no", 8],
    ]) {
      const result = await bash.exec(`jq '${filter}' /missing-input`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [3, "", `jq: undefined variable $${name} at offset ${offset}\n`]);
    }
    const scoped = await bash.exec(`jq -nc --arg x outer '[$x,(1 as $x | $x),$x,(reduce [2,3][] as $n (1; . * $n))]'`);
    assert.equal(scoped.stdout, '["outer",1,"outer",6]\n');
  } finally { bash.dispose(); }
});

test("jq resolves definitions by arity and evaluates filter arguments in their caller's scope", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, value] of [
      ["def f: 1; def f(x): x+1; [$__def_f,f,f(4)]", ["user",1,5]],
      ["def f(g): \"inside\" as $x | [g, g]; \"outside\" as $x | f($x)", ["outside","outside"]],
      ["def step: .+1; def apply(step): 1|step; apply(step)", 2],
      ["def length: 9; [1,2] | length", 9],
    ]) {
      const result = await bash.exec(`jq --arg __def_f user -nc '${filter}'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), value);
    }
  } finally { bash.dispose(); }
});

test("jq env and $ENV read exported variables independently of jq arguments", async () => {
  const bash = new RustWasmBash();
  try {
    const init = "hidden=secret; declare -a a=(private); export __label=first; ";
    for (const [query, expected] of [
      ["jq -nc 'env | keys'", ["PWD", "__label"]],
      ["jq -nc '[env.__label,$ENV.__label,env.hidden,$ENV.a]'", ["first", "first", null, null]],
      [`jq --arg __label argument --arg ENV other -nc '[env.__label,$__label,$ENV]'`, ["first", "argument", "other"]],
      [`jq -nc 'def env: "overridden"; [env,$ENV.__label]'`, ["overridden", "first"]],
    ]) {
      const result = await bash.exec(init + query);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), expected);
    }
  } finally { bash.dispose(); }
});

test("commands receive exported scalar values without array elements or shell bookkeeping", async () => {
  const bash = new RustWasmBash();
  try {
    const init = "hidden=secret; export __shown=ok; declare -a items=(private); export items; ";
    for (const command of ["printenv", "env", "bash -c printenv"]) {
      const result = await bash.exec(init + command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), ["PWD=/workspace", "__shown=ok"]);
    }
    const restored = await bash.exec(init + "op environment snapshot create check >/dev/null; op environment snapshot restore check --shell bash");
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.match(restored.stdout, /__shown/);
    assert.doesNotMatch(restored.stdout, /private|secret|hidden|items|BASH_COMMAND/);
    const result = await bash.exec(init + "printenv 'items[0]' items hidden");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal((await bash.exec(init + "envsubst <<< '$items/$hidden/$__shown'")).stdout, "//ok\n");
  } finally { bash.dispose(); }
});

test("double underscore variables survive exports, shell options and cold checkpoints", async () => {
  const bash = new RustWasmBash({ cwd: "/workspace", env: { __cwd: "cwd-value", __project: "initial" } });
  try {
    const session = bash.createSession();
    const first = await session.exec("export __project=demo; __attr__tag=r; tag=one; tag=two; __umask=text; __set_noexec=1; declare -a __items=([4]=four); echo ok");
    assert.equal(first.stdout, "ok\n");
    assert.equal(first.stderr, "");
    const state = JSON.parse(JSON.stringify(session.state));
    assert.equal(state.cwd, "/workspace");
    assert.equal(state.umask, 0o22);
    assert.equal(state.options.noexec, false);
    assert.equal(state.variables.__attr__tag, "r");
    assert.equal(state.variables.__umask, "text");
    assert.equal(state.exported.includes("__project"), true);
    assert.equal(Object.keys(state.variables).some(name => name.includes("\0")), false);
    const next = await bash.createSession(state).exec(`echo "$__cwd:$tag:\${__items[4]}"; bash -c 'printenv __project'`);
    assert.equal(next.stdout, "cwd-value:two:four\ndemo\n");
  } finally { bash.dispose(); }
});

test("JSON session checkpoints restore bindings without repeating filesystem writes", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession();
    await session.exec("echo once >> /journal; set -- 'two words'; readonly fixed=yes; export KEEP=value; declare -a sparse=([4]=four); f() { echo ok; } > /function-output; export -f f; umask 027; false");
    const checkpoint = JSON.parse(JSON.stringify(session.state));
    await session.exec("EXTRA=gone; unset KEEP; set -- changed");
    session.state = checkpoint;
    for (const restored of [session, bash.createSession(checkpoint)]) {
      const result = await restored.exec('echo "$?:$KEEP:${EXTRA-unset}:$1:${sparse[4]}:$fixed"; bash -c f; cat /function-output /journal; umask');
      assert.equal(result.stdout, "1:value:unset:two words:four:yes\nok\nonce\n0027\n");
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.deepEqual(checkpoint.arrays.sparse.elements, {4: "four"});
    assert.deepEqual(checkpoint.readonlyVariables, ["fixed"]);
    assert.equal(checkpoint.umask, 0o27);
    assert.ok(!("rawHistory" in checkpoint));
  } finally { bash.dispose(); }
});

test("JavaScript and Rust can exchange cold session snapshots", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ fs: new MemoryFileSystem(), cwd: "/" });
  js.use(agentCommands());
  const rust = new RustWasmBash({ cwd: "/" });
  try {
    const setup = "export E=value; set -- 'two words'; readonly fixed=1; declare -i number=3; declare -A m=([foo]='bar baz'); declare -a sparse=([5]=a); f() { echo ok; } > /output; readonly -f f; export -f f; shopt -s nullglob; umask 027; false";
    const source = 'echo "$?:$E:$1:${m[foo]}:${sparse[5]}:$fixed"; number=2+3; echo "$number"; f; read -r line < /output; echo "$line"; umask';
    const snapshots = [];
    for (const [from, to] of [[js, rust], [rust, js]]) {
      const session = from.createSession();
      await session.exec(setup);
      const snapshot = JSON.parse(JSON.stringify(session.state));
      snapshots.push(snapshot);
      const restored = to.createSession(snapshot);
      const result = await restored.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "1:value:two words:bar baz:a:1\n5\nok\n0027\n");
    }
    for (const key of ["exported", "readonlyVariables", "exportedFunctions", "readonlyFunctions"]) {
      for (const s of snapshots) s[key].sort();
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
  } finally { await js.dispose(); rust.dispose(); }
});

test("session checkpoints retain associative key order and distinguish unassigned arrays", async () => {
  const bash = new RustWasmBash();
  try {
    const s = bash.createSession();
    await s.exec("declare -A kv=([z]=first [a]=next); declare -a vacant scalar; declare -a empty=()");
    assert.deepEqual(Object.keys(s.state.arrays.kv.elements), ["z", "a"]);
    assert.equal(s.state.arrays.vacant.assigned, false);
    assert.equal(s.state.arrays.empty.assigned, true);
    s.state = JSON.parse(JSON.stringify(s.state));
    assert.equal((await s.exec('echo "${!kv[@]}"; vacant=(); scalar=yes')).stdout, "z a\n");
    assert.equal(s.state.arrays.vacant.assigned, true);
    assert.deepEqual(s.state.arrays.scalar.elements, {0: "yes"});
  } finally { bash.dispose(); }
});

test("restored positional arguments and aliases honor the expansion byte limit", async () => {
  const bash = new RustWasmBash();
  try {
    const limits = { maxExpansionBytes: 5 };
    for (const bindings of [{ positionalParams: ["ab", "😀"] }, { aliases: { foo: "bar" } }]) {
      const s = bash.createSession({ cwd: "/", ...bindings });
      await assert.rejects(s.exec(": > /x", { limits }), { name: "ShellLimitError", limit: "maxExpansionBytes" });
      assert.equal((await bash.exec("test ! -e /x")).exitCode, 0);
    }
    const state = {cwd: "/", positionalParams: ["a", "😀"], aliases: {foo: "ok"}};
    assert.equal((await bash.exec(":", {state, limits})).exitCode, 0);
  } finally { bash.dispose(); }
});

test("session restore only parses function definitions and never runs legacy history", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession({ cwd: "/", functions: { bad: "echo wrong > /bad" } });
    assert.equal((await session.exec("command -v bad; test ! -e /bad")).exitCode, 0);
    assert.throws(() => bash.createSession({rawHistory: ["echo wrong > /bad"]}), /history/i);
    assert.equal((await bash.exec("test ! -e /bad")).exitCode, 0);
  } finally { bash.dispose(); }
});

test("session hooks can supply a checkpoint and observe the committed turn", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession();
    assert.equal(session.state, undefined);
    const seen = [];
    const beforeExec = ({ source, options }) => {
      seen.push([source, options.cwd]);
      return {cwd: "/", variables: {FROM_HOOK: "yes"}};
    };
    const result = await session.exec('echo "$FROM_HOOK"', {
      cwd: "/workspace",
      hooks: { beforeExec, afterExec(state, res) { seen.push(["after", state === res.state]); } },
      onState(state, res) { seen.push(["state", state === session.state && state === res.state]); },
    });
    assert.equal(result.stdout, "yes\n");
    await session.exec(":", { hooks: { beforeExec } });
    assert.deepEqual(seen, [['echo "$FROM_HOOK"', "/workspace"], ["state", true], ["after", true]]);
    session.state = undefined;
    assert.equal((await session.exec('echo "${FROM_HOOK-unset}"')).stdout, "unset\n");
  } finally { bash.dispose(); }
});

test("session turns run in order across async hooks and recover after rejection", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession();
    let resume, entered;
    const gate = new Promise(resolve => { resume = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const first = session.exec("echo first >> /order", { hooks: { async afterExec() {
      entered();
      await gate;
      throw new Error("hook failed");
    } } });
    await started;
    const second = session.exec("echo second >> /order");
    await Promise.resolve();
    const beforeRelease = bash.readText("/order");
    resume();
    await assert.rejects(first, /hook failed/);
    await second;
    assert.equal(beforeRelease, "first\n");
    assert.equal(bash.readText("/order"), "first\nsecond\n");
  } finally { bash.dispose(); }
});

test("ordinary calls isolate shell state while sharing filesystem changes", async () => {
  const bash = new RustWasmBash({ cwd: "/work", env: { BASE: "initial" }, directories: ["/work/sub"] });
  try {
    const r = await bash.exec('pwd; printf "%s" "$BASE" > file; export BASE=changed EXTRA=yes; f() { echo body; }; cd /', { cwd: "/work/sub", env: { BASE: "override" } });
    assert.equal(r.stdout, "/work/sub\n");
    assert.equal(r.cwd, "/");
    const next = await bash.exec('pwd; echo "$BASE/${EXTRA-unset}"; cat sub/file; command -v f');
    assert.equal(next.stdout, "/work\ninitial/unset\noverride");
    assert.equal(next.exitCode, 1);
  } finally { bash.dispose(); }
});

test("explicit sessions share files but start with separate shell state", async () => {
  const bash = new RustWasmBash({ cwd: "/work", env: { BASE: "initial" } });
  try {
    const a = bash.createSession();
    const b = bash.createSession();
    await a.exec("export BASE=first; printf file > shared");
    assert.equal((await b.exec('echo "$BASE"; cat shared')).stdout, "initial\nfile");
    assert.equal((await bash.exec('echo "$BASE"')).stdout, "initial\n");
    assert.equal((await a.exec('echo "$BASE"')).stdout, "first\n");
  } finally { bash.dispose(); }
});

test("explicit sessions retain the working directory and environment resulting from each turn", async () => {
  const bash = new RustWasmBash({ cwd: "/work", env: { EXISTING: "base" }, directories: ["/work/sub"] });
  try {
    const session = bash.createSession();
    await session.exec("cd sub; export EXISTING=updated", { cwd: "/work", env: { EXISTING: "override", ADDED: "value" } });
    const next = await session.exec('pwd; echo "$EXISTING/$ADDED"');
    assert.equal(next.stdout, "/work/sub\nupdated/value\n");
  } finally { bash.dispose(); }
});

test("symbolic links validate the parent before mutation and report the failing operand", async () => {
  const bash = new RustWasmBash({deviceView: "provided", files: {"/locked/file": "keep"}, symlinks: {"/seed/link": "absent"}});
  try {
    const fs = bash.fs;
    await fs.chmod("/locked", 0o555);
    await assert.rejects(fs.symlink("x", "/missing/link"), {code: "ENOENT", syscall: "symlink", path: "/missing/link"});
    await assert.rejects(fs.stat("/missing"), {code: "ENOENT"});
    await assert.rejects(fs.symlink("x", "/locked/link"), {code: "EACCES"});
    await assert.rejects(fs.readlink("/missing/link"), {code: "ENOENT", syscall: "readlink"});
    await assert.rejects(fs.readlink("/locked/file"), {code: "EINVAL"});
    assert.equal(await fs.readlink("/seed/link"), "absent");
    const signal = AbortSignal.abort(new Error("cancelled"));
    await assert.rejects(fs.symlink("x", "/bad", {signal}), /cancelled/);
    await assert.rejects(fs.readlink("/seed/link", {signal}), /cancelled/);
    await assert.rejects(fs.lstat("/bad"), {code: "ENOENT"});
  } finally { bash.dispose(); }
});

test("gzip compresses repeated bytes and interoperates with an independent decoder", () => {
  const payload = Buffer.from("a repeatable log message\n".repeat(4096));
  const bash = new RustWasmBash({ files: { "/input": payload } });
  try {
    for (const level of [1, 6, 9]) {
      const result = bash.execSync(`gzip -${level}c /input`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(gunzipSync(result.stdoutBytes), payload);
      assert.ok(result.stdoutBytes.length < payload.length / 8);
      assert.equal(result.stdoutBytes[8], level === 1 ? 4 : level === 9 ? 2 : 0);
    }
  } finally {
    bash.dispose();
  }
});

test("WASM Bash forceNative rejects incomplete long listings but preserves literal -l filenames", async () => {
  const bash = new RustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });
  await bash.fs.writeFile("/work/-l", "twelve bytes");
  for (const flags of ["-l", "-la", "-lh", "-g", "-o", "-n"]) {
    const result = await bash.exec(`ls ${flags} -- -l`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /requires the TypeScript safe-bash bridge/);
  }
  const result = await bash.exec("ls -- -l");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "-l\n");
  bash.dispose();
});

test("WASM Bash forceNative executes compression codecs with genuine magic headers", async () => {
  const bash = new RustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    printf 'wasm-unit-test-payload\\n' > input.txt
    gzip -c input.txt > out.gz
    bzip2 -c input.txt > out.bz2
    xz -c input.txt > out.xz
    zstd -c input.txt > out.zst
    echo "OK"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout.trim(), "OK");

  const gz = await bash.fs.readFile("/work/out.gz");
  const bz2 = await bash.fs.readFile("/work/out.bz2");
  const xz = await bash.fs.readFile("/work/out.xz");
  const zst = await bash.fs.readFile("/work/out.zst");

  assert.deepEqual([...gz.slice(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual([...bz2.slice(0, 3)], [0x42, 0x5a, 0x68]);
  assert.deepEqual([...xz.slice(0, 6)], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
  assert.deepEqual([...zst.slice(0, 4)], [0x28, 0xb5, 0x2f, 0xfd]);
});

test("WASM Bash forceNative writes genuine SQLite format 3 pages and supports nested timeout and op/gh", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const sqlRes = await bash.exec(`
    sqlite3 /work/test.db "CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'alpha'), (2, 'beta');"
    sqlite3 /work/test.db "SELECT id, v FROM t ORDER BY id;"
  `);
  assert.equal(sqlRes.exitCode, 0, sqlRes.stderr);
  assert.equal(sqlRes.stdout, "1|alpha\n2|beta\n");

  const dbBytes = await bash.fs.readFile("/work/test.db");
  assert.equal(new TextDecoder().decode(dbBytes.slice(0, 16)), "SQLite format 3\0");
  assert.equal(dbBytes.byteLength % 4096, 0);

  const timeoutRes = await bash.exec(
    `timeout 0.1s timeout 1s sh -c 'sleep 0.25; echo SHOULD_NOT_PRINT'`
  );
  assert.equal(timeoutRes.exitCode, 124);
  assert.equal(timeoutRes.stdout, "");

  const opGhRes = await bash.exec(`
    set -e
    which op gh
    op vault create DevVault > /dev/null
    op item create --vault DevVault --category login --title "App" "password=s3cr3t" > /dev/null
    op read "op://DevVault/App/password"
    gh repo create acme/demo > /dev/null
    gh issue create -R acme/demo -t "Bug" > /dev/null
    gh issue list -R acme/demo --json number | jq 'length'
  `);
  assert.equal(opGhRes.exitCode, 0, opGhRes.stderr);
  assert.equal(opGhRes.stdout, "/bin/op\n/bin/gh\ns3cr3t\n1\n");
});

test("WASM Bash forceNative enforces sleep validation, timeout --preserve-status, and -k kill-after", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/" });

  const badSleep = await bash.exec("sleep; echo ec=$?");
  assert.equal(badSleep.stdout.trim(), "ec=1");
  assert.match(badSleep.stderr, /sleep: missing operand/);

  const badInterval = await bash.exec("sleep not_a_duration; echo ec=$?");
  assert.equal(badInterval.stdout.trim(), "ec=1");
  assert.match(badInterval.stderr, /sleep: invalid time interval/);

  const preserve = await bash.exec("timeout --preserve-status -s INT 0.05s sleep 0.2");
  assert.equal(preserve.exitCode, 130);
});

test("WASM Bash forceNative supports op inject literal braces, file attachments, and secret masking", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    op vault create SecVault > /dev/null
    printf 'pem-payload-data' > /work/tls.pem
    op item create --vault SecVault --category login --title "Service" "password=top-secret-pw" 'tls\\.pem[file]=/work/tls.pem' > /dev/null
    echo "FILE=$(op read 'op://SecVault/Service/tls.pem')"
    printf 'escaped={{ "{{keep}}" }} val={{ op://SecVault/Service/password }}\\n' | op inject
    export SECRET_PW="op://SecVault/Service/password"
    op run -- sh -c 'echo "MASKED=$SECRET_PW"'
    op run --no-masking -- sh -c 'echo "RAW=$SECRET_PW"'
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.match(res.stdout, /FILE=pem-payload-data/);
  assert.match(res.stdout, /escaped=\{\{keep\}\} val=top-secret-pw/);
  assert.match(res.stdout, /MASKED=<concealed by 1Password>/);
  assert.match(res.stdout, /RAW=top-secret-pw/);
});

test("WASM Bash forceNative supports SQLite multi-page B-trees, recursive CTEs, and window functions", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    sqlite3 /work/multi.db "
      CREATE TABLE events (id INTEGER PRIMARY KEY, grp TEXT, val INT);
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 130)
      INSERT INTO events(id, grp, val)
      SELECT n, CASE WHEN n % 2 = 0 THEN 'even' ELSE 'odd' END, n FROM seq;
    "
    sqlite3 /work/multi.db "
      SELECT grp, COUNT(*), SUM(val), DENSE_RANK() OVER (ORDER BY SUM(val) DESC)
      FROM events
      GROUP BY grp
      ORDER BY SUM(val) DESC;
    "
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "even|65|4290|1\nodd|65|4225|2\n");

  const bytes = await bash.fs.readFile("/work/multi.db");
  assert.ok(bytes.byteLength >= 12288);
  assert.equal(bytes.byteLength % 4096, 0);
});

test("WASM Bash forceNative supports /dev/* devices, arrays, namerefs, process substitution, and traps", async () => {
  const bash = createRustWasmBash({ deviceView: "provided", forceNative: true, cwd: "/work" });
  bash.mountDevices();
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -euo pipefail
    trap 'echo "EXIT_TRAP_OK"' EXIT
    head -c 4 /dev/zero | xxd -p
    declare -A kv=([k1]="v1" [k2]="v2")
    target="kv[k2]"
    declare -n ref=target
    echo "NAMEREF=\${!target}"
    diff -u <(printf 'x\\ny\\n') <(printf 'x\\ny\\n')
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "00000000\nNAMEREF=v2\nEXIT_TRAP_OK\n");
});

test("WASM Bash forceNative executes tar compressed archives, jq, csvpy, bc, sed, awk, and dot", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    printf 'col,num\\na,12\\nb,30\\n' > data.csv
    tar -jcf data.tar.bz2 data.csv
    tar -Jcf data.tar.xz data.csv
    tar --zstd -cf data.tar.zst data.csv
    printf 'list(reader)\\nexit()\\n' | csvpy data.csv 2>/dev/null | grep -q "12"
    sum=$(awk -F, 'NR>1 {s+=$2} END {print s}' data.csv)
    doubled=$(echo "$sum * 2" | bc)
    jq -nc --arg d "$doubled" '{result: ($d|tonumber)}'
    echo 'digraph G { x -> y; }' | dot -Tsvg | grep -q '<svg' && echo "DOT_OK"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "{\"result\":84}\nDOT_OK\n");
});

test("in2csv admits JSON table storage under the shell memory limit", () => {
  const bash = new RustWasmBash({
    limits: { maxMemoryBytes: 4096 },
    files: { "/input.json": JSON.stringify(Array.from({ length: 128 }, (_, n) => ({ n }))) },
  });
  try {
    const r = bash.execSync("in2csv /input.json");
    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /memory budget/i);
    assert.equal(r.stdout, "");
    assert.equal(bash.execSync("echo ok").stdout, "ok\n");
  } finally {
    bash.dispose();
  }
});

test("WASM Bash forceNative enforces memoryFsOptions quotas and execution limits", async () => {
  const bash = createRustWasmBash({
    forceNative: true,
    cwd: "/work",
    memoryFsOptions: { maxFileBytes: 32, maxMetadataUnits: 6 },
    limits: { maxLoopIterations: 25 },
  });
  await bash.fs.mkdir("/work", { recursive: true });

  const bigWrite = await bash.exec("head -c 64 /dev/zero > /work/too_big.bin; echo ec=$?");
  assert.match(bigWrite.stdout, /ec=[1-9]/);

  await assert.rejects(() => bash.exec("i=0; while [ $i -lt 100 ]; do i=$((i + 1)); done"), /maxLoopIterations/);
});

test("WASM Bash forceNative supports env -i, -u, -C, and -S split-string execution", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work/sub", { recursive: true });

  const res = await bash.exec(`
    export KEEP="yes" DROP="no"
    env -u DROP -C /work/sub -S 'ONE=1 TWO=2 printenv KEEP ONE TWO'
    env -C /work/sub pwd
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "yes\n1\n2\n/work/sub\n");
});

test("WASM Bash forceNative supports gh pr list --state closed (including merged), release delete, variable, and label", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    gh repo create acme/svc > /dev/null
    gh pr create -R acme/svc -t "PR 1" -H feat-1 > /dev/null
    gh pr create -R acme/svc -t "PR 2" -H feat-2 > /dev/null
    gh pr merge 1 -R acme/svc --squash > /dev/null
    gh pr close 2 -R acme/svc > /dev/null
    echo "CLOSED_PRS=$(gh pr list -R acme/svc --state closed --json number | jq -c 'map(.number)')"
    gh release create v1.0.0 -R acme/svc -t "1.0.0" > /dev/null
    gh release delete v1.0.0 -R acme/svc --yes > /dev/null
    echo "RELEASES=$(gh release list -R acme/svc --json tagName | jq 'length')"
    gh variable set APP_MODE -b "prod" -R acme/svc > /dev/null
    echo "VAR=$(gh variable get APP_MODE -R acme/svc)"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "CLOSED_PRS=[2,1]\nRELEASES=0\nVAR=prod\n");
});

test("WASM Bash forceNative supports zip, unzip -l/-p, and apply_patch", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    printf "line1\nline2\n" > /work/target.txt
    apply_patch <<'PATCH' > /dev/null
*** Begin Patch
*** Update File: /work/target.txt
@@
 line1
-line2
+line2-patched
*** End Patch
PATCH
    zip -q /work/bundle.zip /work/target.txt
    unzip -p /work/bundle.zip work/target.txt
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "line1\nline2-patched\n");
});

test("WASM Bash forceNative supports sqlite3 -json formatting and WITH ... UPDATE correlated subqueries", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    sqlite3 /work/app.db "
      CREATE TABLE users (id INT, tag TEXT);
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2)
      INSERT INTO users SELECT n, 'u-' || n FROM seq;
      WITH patch(id, sfx) AS (VALUES (2, '-vip'))
      UPDATE users SET tag = tag || (SELECT sfx FROM patch WHERE patch.id = users.id)
      WHERE id IN (SELECT id FROM patch);
    "
    sqlite3 -json /work/app.db "SELECT id, tag FROM users ORDER BY id;"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "[{\"id\":1,\"tag\":\"u-1\"},\n{\"id\":2,\"tag\":\"u-2-vip\"}]\n"
  );
});

test("Wasm filesystem removes only entries admitted by rm, unlink and rmdir", async () => {
  const bash = new RustWasmBash({ files: { "/tree/keep": "data" } });
  const { fs } = bash;
  try {
    await assert.rejects(fs.rm("/tree"), { code: "EISDIR" });
    await assert.rejects(fs.unlink("/tree"), { code: "EISDIR" });
    await assert.rejects(fs.rmdir("/tree"), { code: "ENOTEMPTY" });
    await assert.rejects(fs.rmdir("/tree/keep"), { code: "ENOTDIR" });
    await assert.rejects(fs.rm("/tree/.", { recursive: true }), { code: "EINVAL" });
    await assert.rejects(fs.rm("/", { recursive: true }), { code: "EBUSY" });
    assert.equal(bash.readText("/tree/keep"), "data");
    await fs.symlink("/tree", "/alias");
    await fs.unlink("/alias");
    assert.equal(bash.readText("/tree/keep"), "data");
    await fs.rm("/tree", { recursive: true });
    await fs.rm("/tree", { force: true });
    await assert.rejects(fs.rm("/tree"), { code: "ENOENT" });
    await fs.mkdir("/empty");
    await fs.rmdir("/empty");
    await assert.rejects(fs.stat("/empty"), { code: "ENOENT" });
  } finally {
    bash.dispose();
  }
});

test("the default device directory merges null with backing files and is counted once by df", async () => {
  const bash = createRustWasmBash({ files: { "/dev/zero": "ordinary" }, symlinks: { "/discard": "/dev/null" } });
  try {
    const listed = await bash.exec("ls -A /dev; head -c 8 /dev/zero; printf 'discarded' > /discard; wc -c < /dev/null");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(listed.stdout, "null\nzero\nordinary0\n");
    const empty = createRustWasmBash();
    try {
      const usage = await empty.exec("df --output=iused,used /");
      assert.match(usage.stdout, /\b6\s+20\s*$/);
      const absent = await empty.exec("test -e /dev/random");
      assert.equal(absent.exitCode, 1);
    } finally { empty.dispose(); }
  } finally { bash.dispose(); }
});

test("provided devices preserve backing files and the mounted test devices remain readable", async () => {
  const provided = createRustWasmBash({ deviceView: "provided", files: { "/dev/null": "kept" } });
  const mounted = createRustWasmBash({ deviceView: "provided", files: { "/dev/hidden": "backing" } });
  mounted.mountDevices();
  try {
    const result = await provided.exec("cat /dev/null; printf updated > /dev/null; cat /dev/null");
    assert.equal(result.stdout, "keptupdated");
    const devices = await mounted.exec("ls /dev; head -c 2 /dev/zero | xxd -p");
    assert.equal(devices.stdout, "null\nrandom\nurandom\nzero\n0000\n");
  } finally { provided.dispose(); mounted.dispose(); }
});

test("random devices use the host entropy source and fail if it is unavailable", async t => {
  const bash = createRustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  try {
    const random = t.mock.method(globalThis.crypto, "getRandomValues", view => view.fill(0x5a));
    const read = await bash.exec("head -c 16 /dev/urandom");
    assert.equal(read.exitCode, 0, read.stderr);
    assert.deepEqual(read.stdoutBytes, new Uint8Array(16).fill(0x5a));
    assert.ok(random.mock.callCount() > 0);
    random.mock.mockImplementation(() => { throw new Error("entropy unavailable"); });
    const failed = await bash.exec("head -c 16 /dev/random");
    assert.notEqual(failed.exitCode, 0);
    assert.equal(failed.stdoutBytes.length, 0);
  } finally { bash.dispose(); }
});

test("Wasm fs.link retains inode identity and reports the failing operand", async () => {
  const bash = new RustWasmBash({deviceView:"provided", files:{"/src/f":"first", "/keep":"original"}, symlinks:{"/sym":"absent"}});
  const {fs} = bash;
  try {
    await fs.link("/src/f", "/alias");
    await fs.writeFile("/alias", "second");
    assert.equal(bash.readText("/src/f"), "second");
    assert.equal((await fs.stat("/src/f")).nlink, 2);
    await fs.link("/sym", "/alias-sym");
    assert.equal((await fs.lstat("/alias-sym")).ino, (await fs.lstat("/sym")).ino);
    assert.equal(await fs.readlink("/alias-sym"), "absent");
    await assert.rejects(fs.link("/missing", "/new"), {code:"ENOENT", syscall:"link", path:"/missing"});
    await assert.rejects(fs.link("/src/f", "/missing/new"), {code:"ENOENT", syscall:"link", path:"/missing/new"});
    await assert.rejects(fs.link("/src/f", "/keep"), {code:"EEXIST", path:"/src/f", dest:"/keep"});
    await assert.rejects(fs.link("/keep", "/new", {signal:AbortSignal.abort()}), {name:"AbortError"});
    await assert.rejects(fs.link("/keep", "/" + "é".repeat(128)), {code:"ENAMETOOLONG"});
    assert.equal(bash.readText("/keep"), "original");
    await fs.unlink("/alias");
    assert.equal((await fs.stat("/src/f")).nlink, 1);
  } finally { bash.dispose(); }
});

test("fs.link protects the default device view, rejects overlays and respects mount boundaries", async () => {
  const bash = new RustWasmBash({files:{"/file":"keep"}});
  const overlay = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    await assert.rejects(bash.fs.link("/absent", "/dev/null"), {code:"EBUSY", path:"/dev/null"});
    await assert.rejects(overlay.fs.link("/absent", "/new"), {code:"ENOTSUP", syscall:"overlay", path:"/new"});
    bash.mountDevices();
    await assert.rejects(bash.fs.link("/dev/null", "/new"), {code:"EXDEV", dest:"/new"});
    await assert.rejects(bash.fs.link("/file", "/dev"), {code:"EBUSY", dest:"/dev"});
    await assert.rejects(bash.fs.link("/dev/null", "/dev/new"), {code:"ENOTSUP", dest:"/dev/new"});
  } finally { overlay.dispose(); bash.dispose(); }
});

test("Wasm rename moves entries and preserves both paths on failure", async () => {
  const bash = new RustWasmBash({ files: { "/src/file": "source", "/other": "keep" } });
  const fs = bash.fs;
  try {
    await fs.chmod("/src/file", 0o640);
    await fs.symlink("missing", "/src/link");
    await fs.rename("/src/file", "/src/file");
    assert.equal(bash.readText("/src/file"), "source");
    await assert.rejects(fs.rename("/src/file", "/other", { noReplace: true }), { code: "EEXIST" });
    await assert.rejects(fs.rename("/src", "/src/child"), { code: "EINVAL" });
    await assert.rejects(fs.rename("/src/file", "/other", { signal: AbortSignal.abort() }), { name: "AbortError" });
    assert.equal(bash.readText("/other"), "keep");
    await fs.rename("/src", "/moved");
    assert.equal(bash.readText("/moved/file"), "source");
    assert.equal((await fs.stat("/moved/file")).mode & 0o777, 0o640);
    await fs.rename("/moved/link", "/other");
    assert.equal(await fs.readlink("/other"), "missing");
    await assert.rejects(fs.lstat("/src"), { code: "ENOENT" });
  } finally {
    bash.dispose();
  }
});

test("overlay rename moves the merged tree without resurrecting hidden children", async () => {
  const bash = new RustWasmBash({
    profile: "overlay-cow-fs",
    files: { "/dir/a": "lower", "/dir/nested/b": "child", "/dir/deleted": "hidden", "/target/old": "old" },
  });
  const fs = bash.fs;
  try {
    await fs.writeFile("/dir/a", "upper");
    await fs.unlink("/dir/deleted");
    await fs.unlink("/target/old");
    await fs.symlink("missing", "/dir/link");
    await assert.rejects(fs.rename("/dir", "/target", { noReplace: true }), { code: "EEXIST" });
    await fs.rename("/dir", "/target");
    assert.equal(bash.readText("/target/a"), "upper");
    assert.equal(bash.readText("/target/nested/b"), "child");
    assert.equal(await fs.readlink("/target/link"), "missing");
    for (const path of ["/dir", "/target/deleted", "/target/old"]) {
      await assert.rejects(fs.lstat(path), { code: "ENOENT" });
    }
  } finally {
    bash.dispose();
  }
});

test("rename preserves hard links and rejects moves across a mount", async () => {
  const bash = new RustWasmBash({ files: { "/dir/file": "source", "/other": "target" } });
  const fs = bash.fs;
  try {
    assert.equal(bash.execSync("ln /dir/file /alias; ln /other /saved").exitCode, 0);
    await fs.rename("/dir", "/tree");
    await fs.rename("/tree/file", "/alias");
    await fs.rename("/tree/file", "/other");
    assert.equal(bash.readText("/alias"), "source");
    assert.equal(bash.readText("/saved"), "target");
    bash.mountDevices();
    await assert.rejects(fs.rename("/other", "/dev/new"), { code: "EXDEV" });
    await assert.rejects(fs.rename("/other/../other", "/alias"), { code: "ENOTDIR" });
    await fs.rename("/other", "/renamed");
    assert.equal(bash.readText("/alias"), "source");
  } finally {
    bash.dispose();
  }
});

test("realpath walks links before parent components and stays inside a mount", async () => {
  const bash = new RustWasmBash({files:{"/tree/sub/file":"data"}});
  const fs = bash.fs;
  try {
    await fs.symlink("/tree/sub", "/alias");
    assert.equal(await fs.realpath("/alias/../sub/file"), "/tree/sub/file");
    assert.equal(await fs.realpath("alias"), "/tree/sub");
    await assert.rejects(fs.realpath("/missing/../tree"), {code:"ENOENT"});
    await assert.rejects(fs.realpath("/tree/sub/file/"), {code:"ENOTDIR"});
    await fs.symlink("/cycle", "/cycle");
    await assert.rejects(fs.realpath("/cycle"), {code:"ELOOP"});
    bash.mountDevices();
    await fs.symlink("/dev", "/through");
    await assert.rejects(fs.realpath("/through/null"), {code:"EACCES"});
    assert.equal(await fs.realpath("/dev/."), "/dev");
  } finally { bash.dispose(); }
});

test("copyFile preserves destinations on failed copies and applies the source mode", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files: {"/dir/source": {content:"bytes",mode:0o640}, "/dest": {content:"keep",mode:0o600}}});
    const fs = bash.fs;
    try {
      await fs.symlink("/dir/source", "/same");
      await fs.symlink("dest", "/alias");
      await fs.symlink("new", "/dangling");
      await assert.rejects(fs.copyFile("/dir/source", "/alias", {exclusive:true}), {code:"EEXIST"});
      await assert.rejects(fs.copyFile("/dir/source", "/dangling", {exclusive:true}), {code:"EEXIST"});
      if (profile === "overlay-cow-fs") {
        // These links belong to the upper layer, while both targets still live only below.
        await assert.rejects(fs.copyFile("/dir/source", "/same"), {code:"ENOENT"});
        await assert.rejects(fs.copyFile("/same", "/alias"), {code:"ENOENT"});
        assert.equal(bash.readText("/dest"), "keep");
        await fs.writeFile("/dir/source", "bytes");
        await fs.writeFile("/dest", "keep");
      }
      await assert.rejects(fs.copyFile("/dir/source", "/same"), {code:"EINVAL"});
      await assert.rejects(fs.copyFile("/dir/source", "/missing/file"), {code:"ENOENT"});
      await assert.rejects(fs.copyFile("/dir/source", "/dest", {signal:AbortSignal.abort()}), {name:"AbortError"});
      assert.equal(bash.readText("/dest"), "keep");
      await fs.copyFile("/same", "/alias");
      assert.equal(bash.readText("/dest"), "bytes");
      assert.equal((await fs.lstat("/dest")).mode & 0o777, 0o640);
      assert.equal(await fs.readlink("/alias"), "dest");
      if (profile) {
        await assert.rejects(fs.copyFile("/same", "/dangling"), {code:"ENOENT"});
        await fs.copyFile("/same", "/new");
      } else {
        await fs.copyFile("/same", "/dangling");
      }
      assert.equal(bash.readText("/new"), "bytes");
      await fs.chmod("/dest", 0o400);
      await assert.rejects(fs.copyFile("/same", "/dest"), {code:"EACCES"});
    } finally {
      bash.dispose();
    }
  }
});

test("writeFile honors exclusive creation, append, permissions and cancellation", async t => {
  let now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/keep":{content:"old",mode:0o640}}});
    const fs = bash.fs;
    try {
      for (const flag of ["wx", "ax"]) {
        await assert.rejects(fs.writeFile("/keep", "lost", {flag}), {code:"EEXIST"});
      }
      assert.equal(bash.readText("/keep"), "old");
      const accessed = (await fs.stat("/keep")).atimeMs;
      now += 60_000;
      await fs.writeFile("/keep", "!", {flag:"a",mode:0o400});
      assert.equal((await fs.stat("/keep")).atimeMs, accessed);
      assert.equal(bash.readText("/keep"), "old!");
      assert.equal((await fs.stat("/keep")).mode & 0o777, 0o640);
      await fs.symlink("new", "/link");
      await assert.rejects(fs.writeFile("/link", "no", {flag:"wx"}), {code:"EEXIST"});
      if (profile) {
        await assert.rejects(fs.writeFile("/link", "first", {flag:"a"}), {code:"ENOENT"});
        await fs.writeFile("/new", "first", {flag:"ax",mode:0o400});
      } else {
        await fs.writeFile("/link", "first", {flag:"a",mode:0o400});
      }
      assert.equal(bash.readText("/new"), "first");
      await assert.rejects(fs.writeFile("/new", "bad"), {code:"EACCES"});
      await assert.rejects(fs.writeFile("/missing/file", "bad"), {code:"ENOENT"});
      await assert.rejects(fs.writeFile("/keep", "bad", {flag:"r"}), {code:"EINVAL"});
      await assert.rejects(fs.writeFile("/keep", "bad", {mode:0o10000}), {code:"EINVAL"});
      await assert.rejects(fs.writeFile("/keep", "bad", {signal:AbortSignal.abort()}), {name:"AbortError"});
      assert.equal(bash.readText("/keep"), "old!");
      await fs.writeFile("/plain", "created");
      assert.equal((await fs.stat("/plain")).mode & 0o777, 0o666);
    } finally { bash.dispose(); }
  }
});

test("a memory file write publishes its mode and timestamps together", async t => {
  let tick = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => ++tick);
  const bash = new RustWasmBash();
  try {
    for (const flag of ["wx", "a", "w"]) {
      await bash.fs.writeFile("/f", "data", {flag, mode:0o620});
      const {mode, mtimeMs, ctimeMs} = await bash.fs.stat("/f");
      assert.equal(mode & 0o777, 0o620);
      assert.equal(ctimeMs, mtimeMs);
    }
  } finally { bash.dispose(); }
});

test("companion replay retains only completed writes and their original bytes and options", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    const controller = new AbortController();
    const options = {flag:"wx", mode:0o600, signal:controller.signal};
    const bytes = Buffer.from("original");
    await bash.fs.writeFile("/created", bytes, options);
    bytes.fill(0);
    options.mode = 0o400;
    controller.abort();
    await assert.rejects(bash.fs.writeFile("/created", "bad", {flag:"ax"}), {code:"EEXIST"});
    await bash.fs.realpath("/created");
    assert.equal(companion.readText("/created"), "original");
    assert.equal((await companion.fs.stat("/created")).mode & 0o777, 0o600);
  } finally { bash.dispose(); companion.dispose(); }
});

test("constructor seeds use the same creation mode as fs.writeFile", async () => {
  const bash = new RustWasmBash({files:{
    "/nested/text":"hello", "/bytes":new Uint8Array([42]), "/object":{content:"value"},
    "/private":{content:"secret",mode:0o600},
  }});
  try {
    for (const path of ["/nested/text", "/bytes", "/object"]) {
      assert.equal((await bash.fs.stat(path)).mode & 0o777, 0o666, path);
    }
    assert.equal((await bash.fs.stat("/private")).mode & 0o777, 0o600);
  } finally { bash.dispose(); }
});

test("readFile enforces read and directory search permissions, byte caps, and aborts", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/dir/file":"data", "/secret":{content:"hidden",mode:0o200}}, symlinks:{"/alias":"secret"}});
    const fs = bash.fs;
    try {
      for (const path of ["/secret", "/alias"]) {
        await assert.rejects(fs.readFile(path), {name:"FsError",code:"EACCES",syscall: profile === "overlay-cow-fs" ? "overlay" : "readFile",path: profile === "overlay-cow-fs" ? "/secret" : path});
      }
      await assert.rejects(fs.readFile("/dir"), {code:"EISDIR"});
      await assert.rejects(fs.readFile("/dir/file", {maxBytes:3}), {code:"EFBIG"});
      await assert.rejects(fs.readFile("/dir/file", {maxBytes:-1}), {code:"EINVAL"});
      await assert.rejects(fs.readFile("/missing", {maxBytes:-1}), {code:profile ? "ENOENT" : "EINVAL"});
      await assert.rejects(fs.readFile("/secret", {maxBytes:-1}), {code:profile === "overlay-cow-fs" ? "EACCES" : "EINVAL"});
      await assert.rejects(fs.readFile("/dir/file", {signal:AbortSignal.abort()}), {name:"AbortError"});
      for (const maxBytes of [4, Infinity]) {
        assert.deepEqual(await fs.readFile("/dir/file", {maxBytes}), new TextEncoder().encode("data"));
      }
      await fs.chmod("/dir", 0o600);
      await assert.rejects(fs.readFile("/dir/file"), {code:"EACCES"});
    } finally { bash.dispose(); }
  }
});


test("mounted streams without EOF cannot be read as whole files", async () => {
  const bash = new RustWasmBash({deviceView:"provided"});
  try {
    bash.mountDevices();
    for (const name of ["zero", "urandom", "random"]) {
      await assert.rejects(bash.fs.readFile("/dev/" + name, {maxBytes:4}), {code:"EFBIG"});
    }
    assert.deepEqual(await bash.fs.readFile("/dev/null", {maxBytes:0}), new Uint8Array());
    await assert.rejects(bash.fs.readFile("/dev/null", {maxBytes:Infinity}), {code:"EINVAL"});
  } finally { bash.dispose(); }
});

test("the strict budget profile mounts the virtual devices used by production", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev"});
  try {
    assert.equal((await bash.exec("ls /dev; head -c 80 /dev/zero | wc -c")).stdout, "null\nrandom\nurandom\nzero\n80\n");
    await bash.fs.writeFile("/dev/null", "discard");
    assert.equal((await bash.fs.readFile("/dev/null")).length, 0);
    await assert.rejects(bash.fs.writeFile("/dev/urandom", "denied"), {code:"EPERM"});
  } finally { bash.dispose(); }
});

test("stat identifies aliases, renames and replacements within one filesystem", async () => {
  const a = new RustWasmBash({files:{"/original":"value"}});
  const b = new RustWasmBash({files:{"/original":"other"}});
  try {
    const key = st => [st.identityScope, st.dev, st.ino];
    const original = await a.fs.stat("/original");
    assert.equal(typeof original.identityScope, "symbol");
    assert.ok(Number.isSafeInteger(original.dev) && Number.isSafeInteger(original.ino));
    assert.notEqual((await b.fs.stat("/original")).identityScope, original.identityScope);
    await a.fs.symlink("/original", "/link");
    assert.deepEqual(key(await a.fs.stat("/link")), key(original));
    assert.notDeepEqual(key(await a.fs.lstat("/link")), key(original));
    await a.fs.rename("/original", "/renamed");
    assert.deepEqual(key(await a.fs.stat("/renamed")), key(original));
    await a.fs.writeFile("/original", "replacement");
    assert.notDeepEqual(key(await a.fs.stat("/original")), key(original));
  } finally { a.dispose(); b.dispose(); }
});

test("overlay reads verify each followed link against the layer that owns it", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/lower/file":"value"}});
  const {fs} = bash;
  try {
    const alias = "/a:b'c";
    await fs.symlink("lower", alias);
    assert.equal((await fs.lstat(alias)).type, "symlink");
    for (const op of ["stat", "readFile", "readdir", "realpath"]) {
      await assert.rejects(fs[op](alias + "/file"), {code:"ENOENT", syscall:"realpath", path:alias + "/file"});
    }
    await assert.rejects(fs.lstat(alias + "/file"), {code:"ENOENT", syscall:"realpath", path:alias});
    await fs.writeFile("/lower/file", "upper");
    assert.equal(new TextDecoder().decode(await fs.readFile(alias + "/file")), "upper");
  } finally { bash.dispose(); }
});

test("memory overlay directory scopes distinguish siblings and keep symlink aliases together", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/src/dir/file":"data"}, symlinks:{"/alias":"/src/dir"}});
  try {
    const parent = await bash.fs.stat("/src"), child = await bash.fs.stat("/src/dir");
    assert.notEqual(parent.identityScope, child.identityScope);
    assert.equal((await bash.fs.stat("/alias")).identityScope, child.identityScope);
    assert.notEqual((await bash.fs.lstat("/alias")).identityScope, child.identityScope);
    const r = await bash.exec("cp -Rx /src /copy");
    assert.equal(r.exitCode, 0, r.stderr);
    assert.deepEqual(await bash.fs.readdir("/copy/dir"), []);
    await bash.fs.chmod("/src", 0o750);
    await bash.fs.writeFile("/src/dir/new", "upper");
    for (const [path, before] of [["/src", parent], ["/src/dir", child]]) {
      const after = await bash.fs.stat(path);
      assert.deepEqual([after.identityScope, after.dev, after.ino], [before.identityScope, before.dev, before.ino]);
    }
    await bash.fs.rename("/src", "/moved");
    assert.notEqual((await bash.fs.stat("/moved")).identityScope, parent.identityScope);

  } finally { bash.dispose(); }
});

test("stat and lstat resolve parents before '..' and report inaccessible entries", async () => {
  const bash = new RustWasmBash({files:{"/tree/sub/file":"data", "/tree/x":"nested", "/x":"root"}, symlinks:{"/alias":"tree/sub"}});
  try {
    for (const op of ["stat", "lstat"]) {
      assert.equal((await bash.fs[op]("/alias/../x")).ino, (await bash.fs.stat("/tree/x")).ino);
      for (const [path, code] of [["/missing/../x","ENOENT"], ["/x/","ENOTDIR"]]) {
        await assert.rejects(bash.fs[op](path), {name:"FsError",syscall:op,path,code});
      }
      await assert.rejects(bash.fs[op]("/x", {signal:AbortSignal.abort()}), {name:"AbortError"});
    }
    await bash.fs.chmod("/tree", 0o600);
    await assert.rejects(bash.fs.lstat("/tree/sub/file"), {code:"EACCES",syscall:"lstat"});
    bash.mountDevices();
    assert.equal((await bash.fs.stat("/dev/zero")).type, "character");
    await assert.rejects(bash.fs.stat("missing"), {code:"ENOENT",syscall:"stat",path:"/missing"});
  } finally { bash.dispose(); }
});

test("open descriptors retain the file across rename, unlink, and replacement", async () => {
  const bash = new RustWasmBash({files:{"/entry":"first"}});
  const fs = bash.fs;
  try {
    const reader = await fs.open("/entry", {access:"read"});
    const writer = await fs.open("/entry", {access:"readwrite"});
    const original = await reader.stat();
    await fs.rename("/entry", "/renamed");
    await fs.writeFile("/entry", "replacement");
    await fs.writeFile("/renamed", "changed");
    await fs.unlink("/renamed");
    assert.equal(await writer.write(Buffer.from("!"), 7), 1);
    assert.equal(await writer.getPosition(), 0);
    const buf = Buffer.alloc(16, 63);
    assert.equal(await reader.read(buf, null), 8);
    assert.equal(buf.toString(), "changed!????????");
    assert.equal(await reader.getPosition(), 8);
    assert.equal((await reader.stat()).ino, original.ino);
    assert.equal((await reader.stat()).nlink, 0);
    assert.equal(await reader.read(buf, null), 0);
    await writer.truncate(2);
    assert.equal((await reader.stat()).size, 2);
    assert.equal(bash.readText("/entry"), "replacement");
    await assert.rejects(reader.write(buf, null), {code:"EBADF"});
    await reader.close();
    await assert.rejects(reader.read(buf, 0), {code:"EBADF"});
    await writer.close();
  } finally { bash.dispose(); }
});

test("descriptor append, sparse writes, cancellation and close preserve cursor ordering", async () => {
  const bash = new RustWasmBash({files:{"/entry":"a"}, symlinks:{"/link":"entry"}});
  try {
    const fs = bash.fs;
    await assert.rejects(fs.open("/link", {access:"write",creation:"exclusive"}), {code:"EEXIST"});
    await assert.rejects(fs.open("/link", {access:"read",noFollow:true}), {code:"ELOOP"});
    const fd = await fs.open("/entry", {access:"readwrite", append:true});
    await fs.writeFile("/entry", "ab");
    await assert.rejects(fd.write(Buffer.from("x"), 0), {code:"EINVAL"});
    assert.equal(await fd.write(Buffer.from("c"), null), 1);
    assert.equal(await fd.getPosition(), 3);
    const controller = new AbortController();
    const first = fd.write(Buffer.from("d"), null);
    const skipped = fd.write(Buffer.from("x"), null, {signal:controller.signal});
    controller.abort();
    const closed = fd.close();
    assert.equal(await first, 1);
    await assert.rejects(skipped, {name:"AbortError"});
    await closed;
    assert.equal(bash.readText("/entry"), "abcd");

    const sparse = await fs.open("/new", {access:"readwrite",creation:"exclusive",mode:0o600});
    await sparse.write(Buffer.from("z"), 3);
    assert.deepEqual([...await fs.readFile("/new")], [0,0,0,122]);
    assert.equal(await sparse.getPosition(), 0);
    await sparse.close();
  } finally { bash.dispose(); }
});

test("mounted descriptors distinguish seekable files from streams and overlay admission", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev"});
  const overlay = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    await assert.rejects(overlay.fs.open("/absent", {}), {code:"ENOTSUP"});
    await assert.rejects(bash.fs.open("/dev/missing", {access:"readwrite",creation:"ifMissing",noFollow:true}), {code:"ENOTSUP"});
    const fd = await bash.fs.open("/dev/zero", {access:"readwrite"});
    const buf = Buffer.alloc(65537, 0xff);
    assert.equal(await fd.read(buf, null), buf.length);
    assert.equal(await fd.getPosition(), buf.length);
    assert.equal(await fd.probeRead(), "ready");
    assert.ok(buf.every(b => b === 0));
    await fd.close();
    const random = await bash.fs.open("/dev/urandom", {access:"write"});
    await assert.rejects(random.write(new Uint8Array(), null), {code:"EPERM"});
    await random.close();
  } finally { bash.dispose(); overlay.dispose(); }
});

test("mv unlinks the source only after a successful cross-device write", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev", files:{"/file":"keep", "/tree/a":"child"}});
  try {
    const reader = await bash.fs.open("/file", {access:"read"});
    for (const [args, error] of [
      ["/file/ /dev/null", "ENOTDIR: not a directory, rename '/file/' -> '/dev/null'"],
      ["/file /dev/missing/new", "ENOENT: no such file or directory, rename '/file' -> '/dev/missing/new'"],
      ["-b /file /dev/null", "ENOTSUP: operation not supported, rename '/dev/null' -> '/dev/null~'"],
      ["/dev/missing /dev/new", "ENOENT: no such file or directory, rename '/dev/missing' -> '/dev/new'"],
    ]) {
      const failed = await bash.exec("mv " + args);
      assert.equal(failed.stderr, "mv: " + error + "\n");
      assert.equal(bash.readText("/file"), "keep");
    }
    const rejected = await bash.exec("mv /file /dev/urandom");
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stderr, "mv: EPERM: operation not permitted, writeStream '/dev/urandom'\n");
    assert.equal(bash.readText("/file"), "keep");
    assert.equal((await bash.exec("mv -n /file /dev/new")).exitCode, 1);
    assert.equal((await bash.exec("mv /tree /dev/null")).exitCode, 1);
    assert.equal(bash.readText("/tree/a"), "child");
    const moved = await bash.exec("mv -v /file /dev/null");
    assert.equal(moved.stdout, "renamed '/file' -> '/dev/null'\n");
    assert.equal(moved.exitCode, 0, moved.stderr);
    await assert.rejects(bash.fs.stat("/file"), {code:"ENOENT"});
    const buf = Buffer.alloc(4);
    assert.equal(await reader.read(buf, null), 4);
    assert.equal(buf.toString(), "keep");
    await reader.close();
  } finally { bash.dispose(); }
});

test("seed directories and implicit parents use the production memory filesystem modes", async () => {
  const bash = new RustWasmBash({cwd:"/project/work", directories:["/seed/deep"], files:{"/nested/files/a":"data"}});
  try {
    assert.equal((await bash.fs.stat("/")).mode & 0o7777, 0o755);
    for (const dir of ["/workspace", "/project", "/project/work", "/seed", "/seed/deep", "/nested", "/nested/files"]) {
      assert.equal((await bash.fs.stat(dir)).mode & 0o7777, 0o777, dir);
    }
  } finally { bash.dispose(); }
});

test("mkdir -p applies the shell umask to new parents and -m to the final directory", async () => {
  const bash = new RustWasmBash({directories:["/existing"]});
  try {
    const result = await bash.exec("umask 077; mkdir -pm 750 /existing/private/leaf");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await bash.fs.stat("/existing/private")).mode & 0o7777, 0o700);
    assert.equal((await bash.fs.stat("/existing/private/leaf")).mode & 0o7777, 0o750);
    assert.equal((await bash.fs.stat("/existing")).mode & 0o7777, 0o777);
  } finally { bash.dispose(); }
});

test("fs.mkdir creates only requested entries, respects search permissions and preserves existing modes", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, directories:["/keep"], files:{"/file":"data"}, symlinks:{"/alias":"/keep","/dang":"missing/dir"}});
    const fs = bash.fs;
    try {
      await assert.rejects(fs.mkdir("/absent/leaf"), {code:"ENOENT", path:profile === "overlay-cow-fs" ? "/absent" : "/absent/leaf", syscall:profile === "overlay-cow-fs" ? "overlay" : "mkdir"});
      await assert.rejects(fs.stat("/absent"), {code:"ENOENT"});
      await assert.rejects(fs.mkdir("/keep", {mode:0}), {code:"EEXIST"});
      await fs.mkdir("/keep", {recursive:true, mode:0});
      assert.equal((await fs.stat("/keep")).mode & 0o777, 0o777);
      await fs.mkdir("/new/child", {recursive:true, mode:0o710});
      for (const path of ["/new","/new/child"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o710);
      await assert.rejects(fs.mkdir("/file", {recursive:true}), {code:"EEXIST"});
      await assert.rejects(fs.mkdir("/file/", {recursive:true}), {code:"ENOTDIR"});
      await assert.rejects(fs.mkdir("/locked/child", {recursive:true,mode:0}), {code:"EACCES"});
      assert.equal((await fs.stat("/locked")).mode & 0o777, 0);
      await assert.rejects(fs.mkdir(null), {code:"EINVAL"});
      await assert.rejects(fs.stat("/null"), {code:"ENOENT"});
      await assert.rejects(fs.mkdir("/abort", {signal:AbortSignal.abort()}), {name:"AbortError"});
      await assert.rejects(fs.stat("/abort"), {code:"ENOENT"});
      if (profile === "strict-budgets-mount-dev") {
        await assert.rejects(fs.mkdir("/dev"), {code:"EBUSY"});
        await assert.rejects(fs.mkdir("/dev/foo"), {code:"ENOTSUP"});
        await assert.rejects(fs.mkdir("/dang", {recursive:true}), {code:"ENOENT"});
        await assert.rejects(fs.mkdir("/staged/../file", {recursive:true}), {code:"EEXIST"});
        await assert.rejects(fs.stat("/staged"), {code:"ENOENT"});
      } else if (profile === "overlay-cow-fs") {
        await assert.rejects(fs.mkdir("/dang", {recursive:true}), {code:"ENOTSUP"});
      } else {
        await fs.mkdir("/dang", {recursive:true});
        assert.equal((await fs.stat("/missing/dir")).type, "directory");
      }
    } finally { bash.dispose(); }
  }
});

test("mkdir replay retains parents created before a recursive failure", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    await assert.rejects(bash.fs.mkdir("/unsearchable/child", {recursive:true, mode:0}), {code:"EACCES"});
    assert.equal((await bash.fs.stat("/unsearchable")).mode & 0o777, 0);
    await bash.fs.realpath("/");
    assert.equal((await companion.fs.stat("/unsearchable")).mode & 0o777, 0);
  } finally { bash.dispose(); companion.dispose(); }
});

test("async readdir returns typed entries in JavaScript order and admits bounded listings", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, directories:["/dir/𐀀"], files:{"/dir/":"data"}, symlinks:{"/dir/link":"missing"}});
    try {
      assert.deepEqual(await bash.fs.readdir("/dir", {maxEntries:3}), [
        {name:"link", type:"symlink"}, {name:"𐀀", type:"directory"}, {name:"", type:"file"},
      ]);
      assert.ok(bash.readdir("/dir").every(name => typeof name === "string"));
      await assert.rejects(bash.fs.readdir("/dir", {maxEntries:2}), {code:"EFBIG", path:"/dir"});
      await assert.rejects(bash.fs.readdir("/missing", {maxEntries:-1}), {code:"EINVAL", syscall:"readdir"});
      assert.deepEqual(await bash.fs.readdir("/dir/𐀀", {maxEntries:0}), []);
      if (profile === "strict-budgets-mount-dev") {
        assert.ok((await bash.fs.readdir("/dev")).every(e => e.type === "character"));
        await assert.rejects(bash.fs.readdir("/dev", {maxEntries:Infinity}), {code:"EINVAL"});
      }
      if (profile === "overlay-cow-fs") {
        await bash.fs.unlink("/dir/link");
        await assert.rejects(bash.fs.readdir("/dir", {maxEntries:2}), {code:"EFBIG"});
        await bash.fs.writeFile("/dir/link", "upper");
        assert.equal((await bash.fs.readdir("/dir", {maxEntries:3}))[0].type, "file");
      }
    } finally { bash.dispose(); }
  }
});

test("readdir refuses unreadable directories and resolves ancestors before '..'", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/private/secret":"value", "/readable/file":"data", "/dev/secret":"value"}});
    try {
      if (!profile) {
        await bash.fs.chmod("/dev", 0o100);
        await assert.rejects(bash.fs.readdir("/dev"), {code:"EACCES"});
      }
      await bash.fs.chmod("/private", 0o100);
      await assert.rejects(bash.fs.readdir("/private"), {code:"EACCES"});
      assert.throws(() => bash.readdir("/private"), {code:"EACCES"});
      await assert.rejects(bash.fs.readdir("/readable/file"), {code:"ENOTDIR"});
      await assert.rejects(bash.fs.readdir("/missing/../readable"), {code:"ENOENT"});
      await assert.rejects(bash.fs.readdir("/readable", {signal:AbortSignal.abort()}), {name:"AbortError"});
    } finally { bash.dispose(); }
  }
});

test("ls checks search permission before following children, links or '..'", async () => {
  const bash = new RustWasmBash({files:{"/guard/inner/secret":"data","/guard/plain":"file","/open/file":"ok"},symlinks:{"/alias":"guard/inner","/dang":"absent"}});
  try {
    await bash.fs.chmod("/guard", 0);
    for (const [cmd, path] of [
      ["ls -A /guard/inner", "/guard/inner"],
      ["ls -d /guard/inner/secret", "/guard/inner"],
      ["ls /guard/../open", "/guard/../open"],
      ["ls /alias", "/guard/inner"],
    ]) {
      const r = await bash.exec(cmd);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [1,"",`ls: EACCES: permission denied, lstat '${path}'\n`]);
    }
    await bash.fs.chmod("/guard", 0o400);
    assert.equal((await bash.exec("ls /guard")).stdout, "inner\nplain\n");
    const recursive = await bash.exec("ls -R /guard");
    assert.deepEqual([recursive.exitCode,recursive.stdout,recursive.stderr],
      [1,"/guard:\ninner\nplain\n","ls: EACCES: permission denied, lstat '/guard/inner'\n"]);
    const sorted = await bash.exec("ls -S /guard");
    assert.equal(sorted.exitCode, 1);
    assert.equal(sorted.stdout, "");
    await bash.fs.chmod("/guard", 0o700);
    assert.equal((await bash.exec("ls /alias")).stdout, "secret\n");
    assert.equal((await bash.exec("ls -F /alias /dang")).stdout, "/alias@\n/dang@\n");
  } finally { bash.dispose(); }
});

test("ls reports the original directory operand when access through an alias fails", async () => {
  for (const profile of [undefined,"strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile,files:{"/parent/private/data":"a"},symlinks:{"/link":"parent/private"}});
    try {
      await bash.fs.chmod("/parent/private", 0o100);
      assert.equal((await bash.exec("ls /link")).stderr, "ls: EACCES: permission denied, readdir '/link'\n");
      await bash.fs.chmod("/parent", 0);
      const detail = profile ? "capabilitiesFor '/link'" : "lstat '/parent/private'";
      assert.equal((await bash.exec("ls /link")).stderr, "ls: EACCES: permission denied, " + detail + "\n");
    } finally { bash.dispose(); }
  }
});
test("single-entry removal preserves unseen descendants", async () => {
  for (const cmd of ["find /g -maxdepth 0 -delete", "rmdir /g", "rm -d /g"]) {
    const bash = new RustWasmBash({files:{"/g/sub/data":"KEEP"}});
    try {
      await bash.fs.chmod("/g", 0);
      const result = await bash.exec(cmd);
      await bash.fs.chmod("/g", 0o700);
      assert.equal(bash.readText("/g/sub/data"), "KEEP", cmd);
      assert.deepEqual([result.exitCode, result.stderr], [1, cmd.split(" ")[0] + ": ENOTEMPTY: directory not empty, rmdir '/g'\n"]);
    } finally { bash.dispose(); }
  }
});

test("rmdir checks the parent and removes empty unreadable directories", async () => {
  const bash = new RustWasmBash({files:{"/guard/keep":"data"},symlinks:{"/alias":"/guard"}});
  try {
    await bash.fs.mkdir("/guard/empty", {mode:0});
    await bash.fs.chmod("/guard", 0o500);
    await assert.rejects(bash.fs.rmdir("/guard/empty"), {code:"EACCES", syscall:"rmdir", path:"/guard/empty"});
    await assert.rejects(bash.fs.unlink("/guard/keep"), {code:"EACCES", syscall:"rm", path:"/guard/keep"});
    await assert.rejects(bash.fs.rmdir("/alias/"), {code:"ENOTDIR"});
    await bash.fs.chmod("/guard", 0o700);
    await bash.fs.rmdir("/guard/empty");
    assert.equal(bash.readText("/guard/keep"), "data");
  } finally { bash.dispose(); }
});

test("find does not run depth-first actions when directory traversal fails", async () => {
  const bash = new RustWasmBash({files:{"/g/sub/data":"KEEP","/open/data":"OTHER"},symlinks:{"/alias":"/g/sub"}});
  try {
    await bash.fs.chmod("/g", 0);
    for (const [cmd, output, error] of [
      ["find /g", "/g\n", "EACCES: permission denied, readdir '/g'"],
      ["find /g -maxdepth 0 -empty -o -print", "", "EACCES: permission denied, readdir '/g'"],
      ["find /g -delete","", "EACCES: permission denied, readdir '/g'"],
      ["find /g/../open -delete","", "EACCES: permission denied, lstat '/g/../open'"],
      ["find -L /alias","", "EACCES: permission denied, lstat '/g/sub'"],
    ]) {
      const result = await bash.exec(cmd);
      assert.deepEqual([result.exitCode,result.stdout,result.stderr], [1,output,"find: "+error+"\n"]);
    }
    await bash.fs.chmod("/g", 0o400);
    const result = await bash.exec("find /g -depth");
    assert.deepEqual([result.exitCode,result.stdout,result.stderr], [1,"/g\n","find: EACCES: permission denied, lstat '/g/sub'\n"]);
    await bash.fs.chmod("/g", 0o700);
    assert.equal(bash.readText("/g/sub/data"), "KEEP");
    assert.equal(bash.readText("/open/data"), "OTHER");
  } finally { bash.dispose(); }
});

test("recursive removal checks all nonempty directories before deleting anything", async () => {
  for (const profile of [undefined, "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/tree/first":"A","/tree/z/last":"B","/open/file":"C"}});
    try {
      await bash.fs.chmod("/tree/z", 0o500);
      const r = await bash.exec("rm -rf /tree");
      assert.deepEqual([r.exitCode,r.stderr], [1,"rm: EACCES: permission denied, rm '/tree'\n"]);
      await assert.rejects(bash.fs.rm("/tree", {recursive:true,force:true}), {code:"EACCES"});
      await bash.fs.chmod("/tree/z", 0);
      await assert.rejects(bash.fs.rm("/tree/z/../../open", {recursive:true}), {code:"EACCES"});
      const interactive = await bash.exec("rm -ri /tree/z", {stdin:"y\n"});
      assert.deepEqual([interactive.exitCode,interactive.stderr], [1,"rm: EACCES: permission denied, readdir '/tree/z'\n"]);
      await bash.fs.chmod("/tree/z", 0o700);
      assert.equal(bash.readText("/tree/first"), "A");
      assert.equal(bash.readText("/tree/z/last"), "B");
      assert.equal(bash.readText("/open/file"), "C");
      await bash.fs.rm("/tree", {recursive:true});
      await assert.rejects(bash.fs.stat("/tree"), {code:"ENOENT"});
    } finally { bash.dispose(); }
  }
});

test("overlay removal resolves every ancestor before changing either layer", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/g/sub/data":"lower","/open/keep":"KEEP"},symlinks:{"/link":"/g"}});
  try {
    await bash.fs.writeFile("/g/sub/new", new TextEncoder().encode("upper"));
    await bash.fs.chmod("/g", 0);
    for (const [p,code] of [["/g/../open","EACCES"],["/missing/../open","ENOENT"],["/link/","EACCES"]]) {
      await assert.rejects(bash.fs.rm(p, {recursive:true}), {code});
      assert.equal(bash.readText("/open/keep"), "KEEP");
    }
    await bash.fs.rm("/g", {recursive:true});
    await assert.rejects(bash.fs.lstat("/g/sub/new"), {code:"ENOENT"});
    await assert.rejects(bash.fs.lstat("/g/sub/data"), {code:"ENOENT"});
    assert.equal((await bash.fs.lstat("/link")).type, "symlink");
  } finally { bash.dispose(); }
});

test("fs.utimes preserves both timestamps on the inode and propagates failures", async () => {
  const bash = new RustWasmBash({files:{"/file":"keep"}});
  try {
    await bash.fs.link("/file", "/alias");
    bash.symlink("/file", "/sym");
    await bash.fs.utimes("/sym", -1250.25, 1700000000123.456);
    const {atimeMs, mtimeMs} = await bash.fs.stat("/alias");
    assert.deepEqual([atimeMs, mtimeMs], [-1250.25, 1700000000123.456]);
    assert.equal(bash.execSync("stat -c '%.9X %.9Y' /file").stdout, "-1.250250000 1700000000.123456000\n");
    await assert.rejects(bash.fs.utimes("/missing", NaN, 0), {code:"EINVAL", syscall:"utimes", path:"/missing"});
    await assert.rejects(bash.fs.utimes("/missing", 1, 2), {code:"ENOENT", syscall:"utimes", path:"/missing"});
    await assert.rejects(bash.fs.utimes("/file", 1, 2, {signal:AbortSignal.abort()}), {name:"AbortError"});
    assert.equal((await bash.fs.stat("/file")).mtimeMs, mtimeMs);
  } finally { bash.dispose(); }
});

test("memory file timestamps use the host clock when created, read, written and touched", async t => {
  let now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash({files:{"/file":"a"}});
  try {
    const times = async () => {
      const st = await bash.fs.stat("/file");
      return [st.atimeMs, st.mtimeMs];
    };
    const created = now;
    assert.deepEqual(await times(), [created, created]);
    now += 500;
    await bash.fs.writeFile("/file", new Uint8Array([1]));
    assert.deepEqual(await times(), [created, now]);
    const written = now;
    now += 900;
    await bash.fs.readFile("/file");
    assert.deepEqual(await times(), [now, written]);
    now += 1000;
    assert.equal(bash.execSync("touch /file").exitCode, 0);
    assert.deepEqual(await times(), [now, now]);
  } finally { bash.dispose(); }
});

test("date uses the host clock and prefers an existing numeric reference over epoch seconds", async t => {
  t.mock.method(Date, "now", () => 2208988800123);
  const bash = new RustWasmBash({files:{"/w/5":"x"},cwd:"/w"});
  try {
    await bash.fs.utimes("/w/5", 0, -1.25);
    const result = bash.execSync("SOURCE_DATE_EPOCH=5 date +%s.%N; date -d yesterday +%s.%N; date -r 5 +%s.%N; date -r 6 +%s.%N");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2208988800.123000000\n2208902400.123000000\n-1.998750000\n6.000000000\n");
    assert.equal(bash.execSync("date -r '5.' +%s").stderr, "date: ENOENT: no such file or directory, stat '/w/5.'\n");
    assert.equal(bash.execSync("date -r 999999999999999999999999 +%s").stderr, "date: date is outside the supported range\n");
  } finally { bash.dispose(); }
});

test("chmod changes inode status time without changing modification or birth time", async t => {
  const birth = Date.UTC(2040, 0, 1);
  let now = birth;
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash({files:{"/f":"x"}});
  try {
    await bash.fs.link("/f", "/g");
    now += 86_400_000;
    await bash.fs.chmod("/g", 0o600);
    const st = await bash.fs.stat("/f");
    assert.deepEqual([st.birthtimeMs, st.mtimeMs, st.ctimeMs], [birth, birth, now]);
    assert.equal(bash.execSync("stat -c '%W %Y %Z' /g").stdout, "2208988800 2208988800 2209075200\n");
    assert.match(bash.execSync("ls -lc /f").stdout, /2040-01-02 00:00 \/f\n$/);
  } finally { bash.dispose(); }
});

test("find compares the requested inode time at exact minute and day boundaries", async t => {
  const now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash({ files: { "/f": "x" } });
  try {
    await bash.fs.utimes("/f", now + 60_000, now - 60_000);
    for (const [predicate, matches] of [
      ["-amin 0", true], ["-amin -0", true], ["-mmin 1", false],
      ["-mmin 2", true], ["-cmin 0", false], ["-mtime 0", true],
    ]) {
      const result = bash.execSync("find /f " + predicate);
      assert.deepEqual([result.exitCode, result.stdout], [0, matches ? "/f\n" : ""], predicate);
    }
    for (const [predicate, diagnostic] of [
      ["-atime 0", "unsupported expression '-atime'"],
      ["-mmin 9007199254740991", "invalid time '9007199254740991': comparison is out of range"],
      ["-mtime +9007199254740992", "invalid number '9007199254740992'"],
    ]) {
      const result = bash.execSync("find /f " + predicate);
      assert.deepEqual([result.exitCode, result.stderr], [2, "find: " + diagnostic + "\n"]);
    }
  } finally { bash.dispose(); }
});

test("mounted devices retain their creation time while the default null device uses the epoch", async t => {
  let now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash();
  try {
    assert.equal((await bash.fs.stat("/dev/null")).birthtimeMs, 0);
    now += 60_000;
    const mounted = now;
    bash.mountDevices();
    now += 60_000;
    for (const path of ["/dev", "/dev/null", "/dev/zero"]) {
      const st = await bash.fs.stat(path);
      assert.deepEqual([st.birthtimeMs, st.ctimeMs, st.atimeMs, st.mtimeMs], Array(4).fill(mounted));
    }
  } finally { bash.dispose(); }
});

test("chmod reports why a change was denied and leaves permissions intact", async () => {
  const bash = new RustWasmBash({ profile: "overlay-cow-fs", files: { "/w/f": { content: "x", mode: 0o200 } } });
  try {
    await assert.rejects(bash.fs.chmod("/w/f", 0o600), { code: "EACCES", syscall: "overlay", path: "/w/f" });
    await assert.rejects(bash.fs.chmod("/w/f", -1), { code: "EINVAL", syscall: "overlay", path: "/w/f" });
    assert.equal((await bash.fs.stat("/w/f")).mode & 0o7777, 0o200);
    bash.mountDevices();
    await assert.rejects(bash.fs.chmod("/dev/null", 0o600), { code: "ENOTSUP", syscall: "chmod", path: "/dev/null" });
  } finally { bash.dispose(); }
});

test("writeFile reports overlay failures at the resolved operand and prioritizes mount errors", async () => {
  const bash = new RustWasmBash({ profile: "overlay-cow-fs", files: { "/f": { content: "keep", mode: 0o444 } }, symlinks: { "/link": "f" } });
  try {
    await assert.rejects(bash.fs.writeFile("/link", "bad"), { code: "EACCES", syscall: "overlay", path: "/f" });
    await assert.rejects(bash.fs.writeFile("/absent/new", "bad"), { code: "ENOENT", syscall: "overlay", path: "/absent" });
    assert.equal(new TextDecoder().decode(await bash.fs.readFile("/f")), "keep");
    bash.mountDevices();
    await assert.rejects(bash.fs.writeFile("/dev", "bad", { flag: "invalid" }), { code: "EBUSY", syscall: "writeFile", path: "/dev" });
    await assert.rejects(bash.fs.writeFile("/dev/absent", "bad"), { code: "ENOENT", syscall: "writeFile", path: "/dev/absent" });
  } finally { bash.dispose(); }
});

test("stat distinguishes absent fields, a zero allocation, and a real inode", async () => {
  const bash = new RustWasmBash({files:{"/f":"content","/g":"other"}});
  try {
    const {fs} = bash;
    const f = await fs.stat("/f");
    const nullDevice = await fs.stat("/dev/null");
    assert.deepEqual([f.dev, f.uid, f.gid, f.ioBlockSize, f.filesystemType, f.allocatedBytes],
                     [0, 0, 0, 65536, "memory", undefined]);
    assert.equal(nullDevice.allocatedBytes, 0);
    assert.equal(nullDevice.ino, 1);
    assert.notEqual(f.identityScope, nullDevice.identityScope);
    assert.equal(bash.execSync("stat -c '%i:%o' /f").stdout, f.ino + ":65536\n");
    assert.notEqual(f.ino, (await fs.stat("/g")).ino);
    assert.equal(bash.execSync("stat -c %b /f").stderr, "stat: ENOTSUP: filesystem does not expose b, stat\n");
    assert.equal(bash.execSync("stat -c %b /dev/null").stdout, "0\n");
    bash.mountDevices();
    const mounted = await fs.stat("/dev/null");
    for (const field of ["uid","gid","nlink","ioBlockSize","filesystemType","allocatedBytes"]) {
      assert.equal(Object.hasOwn(mounted, field), false, field);
    }
    assert.equal(bash.execSync("stat -c %u /dev/null").stderr, "stat: ENOTSUP: filesystem does not expose u, stat\n");
  } finally { bash.dispose(); }
});
