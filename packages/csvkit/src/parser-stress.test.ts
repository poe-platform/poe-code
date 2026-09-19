import assert from "node:assert/strict";
import { test } from "vitest";
import { parseArguments } from "./cli/parser.js";
import parserReference from "../../../docs/csvkit/parser-contract-audit-20260917.json" with { type: "json" };

const limits = { maxArguments: 100, maxArgumentBytes: 10000 };
const bytes = (args: readonly string[]) => args.map(arg => new TextEncoder().encode(arg));
const reference = parserReference.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!;
const errorExit = (command: string, message: string) => ({ kind: "exit", status: 2, stdout: "", stderr: reference.commands.find(item => item.name === command)!.usage + `${command}: error: ${message}\n` });

test("unknown short-cluster tails are deferred extras in CPython 3.14", async () => {
  assert.deepEqual(await parseArguments("csvclean", bytes(["-txyz"]), { limits }), errorExit("csvclean", "unrecognized arguments: -xyz"));
  assert.deepEqual(await parseArguments("csvclean", bytes(["-tx", "-K", "bad"]), { limits }), errorExit("csvclean", "argument -K/--skip-lines: invalid int value: 'bad'"));
  assert.deepEqual(await parseArguments("csvclean", bytes(["-tx", "-V"]), { limits }), { kind: "exit", status: 0, stdout: "csvclean 2.2.0\n", stderr: "" });
});

test("a short-cluster tail starting with a prefix remains an immediate error", async () => {
  for (const tail of ["-", "-encoding"]) {
    assert.deepEqual(await parseArguments("csvclean", bytes(["-t" + tail, "-V"]), { limits }), errorExit("csvclean", `argument -t/--tabs: ignored explicit argument '${tail}'`));
  }
});

test("fixed nargs consumes option-looking values without executing their actions", async () => {
  for (const pair of [["--help", "-K"], ["a", "--query"], ["--unknown", "-V"]]) {
    const result = await parseArguments("csvsql", bytes(["--engine-option", ...pair]), { limits });
    if (result.kind !== "parsed") assert.fail(result.stderr);
    assert.deepEqual(result.options.engine_option, [pair]);
    await result.dispose();
  }
  assert.deepEqual(await parseArguments("sql2csv", bytes(["--engine-option", "--", "a"]), { limits }), errorExit("sql2csv", "argument --engine-option: expected 2 arguments"));
  assert.deepEqual(await parseArguments("sql2csv", bytes(["--engine-option", "--help"]), { limits }), errorExit("sql2csv", "argument --engine-option: expected 2 arguments"));
});

test("terminators belong to the positional group that consumes them", async () => {
  for (const [argv, extras] of [
    [["a", "b", "--", "c"], "b -- c"],
    [["a", "-t", "--", "b"], "-- b"],
    [["a", "-t", "--"], "--"],
    [["a", "--", "b"], "b"],
    [["--", "a", "--", "b"], "-- b"]
  ] as const) {
    assert.deepEqual(await parseArguments("csvcut", bytes(argv), { limits }), errorExit("csvcut", `unrecognized arguments: ${extras}`));
  }
  assert.deepEqual(await parseArguments("csvjoin", bytes(["a", "-t", "--", "b"]), { limits }), errorExit("csvjoin", "unrecognized arguments: -- b"));
});

test("CPython 3.14 negative-number prefix classification reaches integer conversion", async () => {
  for (const value of ["-1e3", "-1x", "-.1e3", "-١x", "-𝟙x"]) {
    const result = await parseArguments("csvcut", bytes(["-K", value]), { limits });
    if (result.kind !== "exit") assert.fail("expected invalid integer");
    assert.deepEqual(result, errorExit("csvcut", `argument -K/--skip-lines: invalid int value: '${value}'`));
  }
});

test("unknown option-looking tokens with ASCII spaces are positional or option values", async () => {
  const positional = await parseArguments("csvcut", bytes(["-- no"]), { limits });
  if (positional.kind !== "parsed") assert.fail(positional.stderr);
  assert.equal(positional.options.input_path, "-- no");
  const value = await parseArguments("csvcut", bytes(["-e", "--encoding utf-8"]), { limits });
  if (value.kind !== "parsed") assert.fail(value.stderr);
  assert.equal(value.options.encoding, "--encoding utf-8");
});

test("short clusters preserve equals separators and empty attached values", async () => {
  for (const [token, expected] of [["-te=x", "x"], ["-te=", ""], ["-te==x", "=x"]]) {
    const result = await parseArguments("csvcut", bytes([token!]), { limits });
    if (result.kind !== "parsed") assert.fail(result.stderr);
    assert.equal(result.options.tabs, true);
    assert.equal(result.options.encoding, expected);
  }
  const integer = await parseArguments("csvcut", bytes(["-tK=-1"]), { limits });
  if (integer.kind !== "parsed") assert.fail(integer.stderr);
  assert.equal(integer.options.skip_lines, -1);
  const ignored = await parseArguments("csvcut", bytes(["-tt="]), { limits });
  if (ignored.kind !== "exit") assert.fail("expected explicit argument error");
  assert.deepEqual(ignored, errorExit("csvcut", "argument -t/--tabs: ignored explicit argument ''"));
});

test("3.14 ambiguity and unknown arguments preserve action execution timing", async () => {
  const help = await parseArguments("csvcut", bytes(["--help", "--no"]), { limits });
  assert.equal(help.kind === "exit" && help.status, 0);
  const unknown = await parseArguments("csvcut", bytes(["--unknown", "-V"]), { limits });
  assert.deepEqual(unknown, { kind: "exit", status: 0, stdout: "csvcut 2.2.0\n", stderr: "" });
  assert.deepEqual(await parseArguments("csvcut", bytes(["-K", "--no"]), { limits }), errorExit("csvcut", "argument -K/--skip-lines: expected one argument"));
  assert.deepEqual(await parseArguments("csvcut", bytes(["--no"]), { limits }), errorExit("csvcut", "ambiguous option: --no could match --no-doublequote, --no-header-row, --not-columns"));
});

test("FileType eager opening precedes later ambiguity and disposes earlier stored files", async () => {
  const effects: string[] = [];
  const result = await parseArguments("csvgrep", bytes(["-f", "first", "-f", "second", "--no"]), {
    limits,
    async openMatchFile(path) {
      effects.push(`open:${path}`);
      return { async *lines() { assert.fail("parse must not read match-file lines"); yield ""; }, async close() { effects.push(`close:${path}`); } };
    }
  });
  assert.deepEqual(result, errorExit("csvgrep", "ambiguous option: --no could match --no-doublequote, --no-header-row"));
  assert.deepEqual(effects.slice(0, 2), ["open:first", "open:second"]);
  assert.deepEqual(effects.slice(2).sort(), ["close:first", "close:second"]);
});

test("nargs-two attached values fail and nargs-plus greedily consumes FILE operands", async () => {
  assert.deepEqual(await parseArguments("csvsql", bytes(["--engine-option=echo", "True"]), { limits }), errorExit("csvsql", "argument --engine-option: expected 2 arguments"));
  const greedy = await parseArguments("csvjoin", bytes(["--null-value", "NULL", "input.csv"]), { limits });
  if (greedy.kind !== "parsed") assert.fail(greedy.stderr);
  assert.deepEqual(greedy.options.null_values, ["NULL", "input.csv"]);
  assert.deepEqual(greedy.options.input_paths, ["-"]);
});
