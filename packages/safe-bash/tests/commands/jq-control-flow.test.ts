import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("jq label/break terminates foreach through the public Shell API", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("jq -c '[label $out | foreach range(5) as $i (0; if $i==3 then break $out else .+$i end)]'", { stdin: "null\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "[0,1,3]\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

async function run(source: string, input = "null\n", args: string[] = []) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "jq", args: ["-c", ...args, source], stdin: toByteSource(input),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
  const result = await jqCommand().execute(context);
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

const vectors: readonly [string, string, string][] = [
  ["[label $out | 1, break $out, 2]", "null", "[1]\n"],
  ['[label $out | try (1, break $out, 2) catch "caught"]', "null", '[1,"caught"]\n'],
  ["[label $out | try (1, break $out, 2) catch .]", "null", '[1,{"__jq":0}]\n'],
  ["[label $x | 1, try break $x catch error(.), 2]", "null", "[1]\n"],
  ['[label $x | 1, error({"__jq":0}), 2]', "null", "[1]\n"],
  ["[label $out | (1, break $out, 2)?]", "null", "[1]\n"],
  ["[label $out | 1, (label $inner | 2, break $out, 3), 4]", "null", "[1,2]\n"],
  ["[label $x | 1, (label $x | 2, break $x, 3), 4]", "null", "[1,2,4]\n"],
  ["[(label $x | 1, break $x), 2]", "null", "[1,2]\n"],
  ["[label $out | reduce range(5) as $i (0; if $i==3 then break $out else .+$i end)]", "null", "[]\n"],
  ["[label $x | foreach range(4) as $i (0; .+$i; if $i==2 then break $x else . end)]", "null", "[0,1]\n"],
  ["[label $x | foreach (0, break $x, 1) as $i (0; .+$i)]", "null", "[0]\n"],
  ["[label $x | foreach 1 as $i (break $x; .)]", "null", "[]\n"],
  ["[label $x | 1 as $x | $x, break $x, 2]", "null", "[1]\n"],
  ["[label $x | .]", "null", "[null]\n"],
  ["[range(2) | label $x | ., break $x, 9]", "null", "[0,1]\n"],
  ["[range(2) | label $x | try break $x catch .]", "null", '[{"__jq":0},{"__jq":1}]\n'],
  ["def stop(f): f; [label $x | 1, stop(break $x), 2]", "null", "[1]\n"],
  ["def stop: label $x | 1, break $x, 2; [stop, stop]", "null", "[1,1]\n"],
  [". as $item | $item", '{"value":42}', '{"value":42}\n'],
  ["def f: .; f", '[1,2]', '[1,2]\n'],
  ["..", '{"z":[1,{"a":null}],"b":[]}\n', '{"z":[1,{"a":null}],"b":[]}\n[1,{"a":null}]\n1\n{"a":null}\nnull\n[]\n'],
  ["[.. | numbers]", '{"2":2,"1":1,"0":0}', '[2,1,0]\n'],
  ["..", '9007199254740993123456789\n', '9007199254740993123456789\n'],
  ["..", 'false\nnull\n"abc"\n', 'false\nnull\n"abc"\n'],
  ["reduce .[] as $item (0; .+$item)", "[1,2,3]", "6\n"],
  ["reduce (1,2) as $item (0; (.+$item, .+$item+10))", "null", "23\n"],
  ["reduce (1,2) as $item (10; if $item==1 then empty else [.] end)", "null", "[null]\n"],
  ["reduce (1,2) as $item (0; (.+$item, empty))", "null", "3\n"],
  ["reduce empty as $item (9; .+$item)", "null", "9\n"],
  ["reduce .a as $item (empty; .+$item)", "1", ""],
  ["reduce .[] as $item (null; $item)", "[9007199254740993123456789]", "9007199254740993123456789\n"],
  ["reduce (1,2) as $item ((0,100); .+$item)", "null", "3\n103\n"],
  ['reduce . as $item (([],["seed"]); .+[$item])', "[1,2]", '[[1,2]]\n["seed",null]\n'],
  ["reduce .[]? as $item ((0,100); .+$item)", "[1,2]", "3\n100\n"],
  ["reduce ([1,2]|.[]) as $item ((0,100); .+$item)", "[1,2]", "3\n103\n"],
  ["foreach (1,2) as $item (0; (.+$item, .+$item+10))", "null", "1\n11\n13\n23\n"],
  ["foreach .[] as $item (0; .+$item; .,-.)", "[1,2]", "1\n-1\n3\n-3\n"],
  ["foreach (1,2) as $item (0; .+$item; if $item==1 then empty else . end)", "null", "3\n"],
  ["foreach (1,2) as $item (0; .+$item; .+100)", "null", "101\n103\n"],
  ["foreach (1,2) as $item (10; if $item==1 then empty else [.] end)", "null", "[null]\n"],
  ["foreach (1,2) as $item (0; empty)", "null", ""],
  ["foreach empty as $item (9; .+$item)", "null", ""],
  ["foreach .a as $item (empty; .+$item)", "1", ""],
  ["foreach .[] as $item ((0,100); .+$item)", "[1,2]", "1\n3\n101\n103\n"],
  ["foreach (1,2) as $item ((0,100); .+$item)", "null", "1\n3\n101\n103\n"],
  ['foreach . as $item (([],["seed"]); .+[$item])', "[1,2]", '[[1,2]]\n["seed",[1,2]]\n'],
  ["foreach .[]? as $item ((0,100); .+$item)", "[1,2]", "1\n3\n101\n103\n"],
  ["reduce (1,2) as $item (0; . + (reduce (3,4) as $item (0; .+$item)) + $item)", "null", "17\n"],
  ["try (1,.a,2) catch \"caught\"", "1", '1\n"caught"\n'],
  ["try (1,.a,2) catch empty", "1", "1\n"],
  ["try .a catch (.,.)", "1", '"Cannot index number with string \\"a\\""\n"Cannot index number with string \\"a\\""\n'],
  ["try .a", "1", ""],
  ["try .a,2", "1", "2\n"],
  ["try (1 | .a)", "null", ""],
  ["try (1/0)", "null", ""],
  ["try .a catch \"caught\" | length", '{"a":[1,2]}', "2\n"],
  ["try .a catch \"caught\" | length", "1", "6\n"],
  ["try (try .a catch .b) catch \"outer\"", "1", '"outer"\n'],
  ["try empty catch \"caught\"", "null", ""],
  ["try (false,null) catch \"caught\"", "null", "false\nnull\n"],
  ["try fromjson catch type", '"{"', '"string"\n'],
  ["try fromjson catch .", '"bad"', '"Invalid numeric literal at EOF at line 1, column 3 (while parsing \'bad\')"\n'],
];

for (const [source, input, stdout] of vectors) test(`jq control flow: ${source} on ${input}`, async () => {
  assert.deepEqual(await run(source, input), { status: 0, stdout, stderr: "" });
});

test("loop lexical shadowing preserves CLI binding in source, initializer and after loop", async () => {
  assert.deepEqual(await run('(reduce ($item,2) as $item ($item; .+$item)), $item', "null", ["--argjson", "item", "7"]),
    { status: 0, stdout: "16\n7\n", stderr: "" });
});

test("jq 1.8.2 reduce replays its source on null after the first initializer", async () => {
  assert.deepEqual(await run("reduce .[] as $item ((0,100); .+$item)", "[1,2]\n"), {
    status: 5, stdout: "3\n", stderr: "jq: error (at <stdin>:1): Cannot iterate over null (null)\n",
  });
});

for (const source of ["try 1 | .a", "try 1/0", "try .a catch .b"]) test(`try does not catch outside its body: ${source}`, async () => {
  const result = await run(source, "1");
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("jq: error"));
});

for (const source of [
  "break $missing", "label $x | $x", "(label $x | .), break $x",
  "label x | .", "label $x .", "label $x | break x", "label $x | missing",
  "reduce (1,2) as $item ($item; .)", "foreach $item as $item (0; .)",
  "(reduce 1 as $item (0; .)), $item", "foreach 1 as $item (0; .; $missing)",
  "try (1 +) catch 0", "try missing catch 0", "try . catch missing",
  ".. =", "try error(1;2) catch .",
  "reduce 1,2 as $item (0; .+$item)", "reduce .[] | . as $item (0; .+$item)",
  'try 1/0 catch "caught"', 'try 1 | .a catch "caught"',
]) test(`control-flow compilation stays closed: ${source}`, async () => {
  const result = await run(source);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
});

test("recursive assignment compiles and retains input-dependent runtime errors", async () => {
  assert.deepEqual(await run(".. = 1"), { status: 0, stdout: "1\n", stderr: "" });
  const result = await run(".. = 1", '{"a":[2,3]}\n');
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, 'jq: error (at <stdin>:1): Cannot index number with string "a"\n');
});

test("try does not catch input parse failures", async () => {
  const baseline = await run(".", "{\n");
  assert.equal(baseline.status, 5);
  assert.deepEqual(await run('try . catch "caught"', "{\n"), baseline);
});

test("labels do not swallow ordinary runtime errors", async () => {
  assert.deepEqual(await run('label $x | error("broken")'), await run('error("broken")'));
});

test("try preserves jq exit-status selection", async () => {
  assert.deepEqual(await run("try .a", "1", ["-e"]), { status: 4, stdout: "", stderr: "" });
  assert.deepEqual(await run("try .a catch false", "1", ["-e"]), { status: 1, stdout: "false\n", stderr: "" });
});

for (const mode of ["--stream", "--stream-errors"]) test(`jq ${mode} emits leaf and container-end events`, async () => {
  assert.deepEqual(await run(".", '{"a":[1],"b":{},"c":[[]]}', [mode]), {
    status: 0, stdout: '[["a",0],1]\n[["a",0]]\n[["b"],{}]\n[["c",0],[]]\n[["c",0]]\n[["c"]]\n', stderr: "",
  });
});

test("jq stream-errors emits parse errors with their paths", async () => {
  assert.deepEqual(await run(".", "[1,x,2]", ["--stream-errors"]), {
    status: 0, stdout: '[[0],1]\n["Invalid numeric literal at line 1, column 5",[1]]\n', stderr: "",
  });
});

test("jq seq reads and frames records", async () => {
  assert.deepEqual(await run(". + 1", "\x1e1\n\x1e2\n", ["--seq"]), {
    status: 0, stdout: "\x1e2\n\x1e3\n", stderr: "",
  });
});

test("jq seq skips input before the first record separator", async () => {
  assert.deepEqual(await run(".", "ignored\x1e1\n", ["--seq"]), {
    status: 0, stdout: "\x1e1\n", stderr: "",
  });
});

test("jq stream-errors resumes at the next input line", async () => {
  assert.deepEqual(await run(".", "[1,x,2]\n3\n", ["--stream-errors"]), {
    status: 0, stdout: '[[0],1]\n["Invalid numeric literal at line 1, column 5",[1]]\n[[],3]\n', stderr: "",
  });
});

test("jq seq resynchronizes after malformed records and preserves locations", async () => {
  assert.deepEqual(await run(".", "bad\x1e1\n\x1ebad\n\x1e2\n", ["--seq"]), {
    status: 0, stdout: "\x1e1\n\x1e2\n",
    stderr: "jq: ignoring parse error: Invalid numeric literal at line 3, column 0 (need RS to resync)\n",
  });
});

test("jq seq reports incomplete final records without a resync instruction", async () => {
  assert.deepEqual(await run(".", "\x1etrue\n\x1e{\n", ["--seq"]), {
    status: 0, stdout: "\x1etrue\n",
    stderr: "jq: ignoring parse error: Unfinished JSON term at EOF at line 3, column 0\n",
  });
});

test("jq seq refuses potentially truncated numbers without terminating whitespace", async () => {
  assert.deepEqual(await run(".", "\x1e1\x1e2", ["--seq"]), {
    status: 0, stdout: "",
    stderr: "jq: ignoring parse error: Potentially truncated top-level numeric value at line 1, column 3\njq: ignoring parse error: Potentially truncated top-level numeric value at EOF at line 1, column 4\n",
  });
});
