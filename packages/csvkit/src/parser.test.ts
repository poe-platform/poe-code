import assert from "node:assert/strict";
import { test } from "vitest";
import { parseArguments } from "./cli/parser.js";
import { commands } from "./commands.js";

const bytes = (args: readonly string[]) => args.map(arg => new TextEncoder().encode(arg));
const limits = { maxArguments: 100, maxArgumentBytes: 10000 };

test("CPython 3.14 choice diagnostics quote converted values and print choices as text", async () => {
  const cases = [
    ["csvformat", ["-U", "6"], "argument -U/--out-quoting: invalid choice: '6' (choose from 0, 1, 2, 3, 4, 5)"],
    ["csvcut", ["-u", "-١"], "argument -u/--quoting: invalid choice: '-1' (choose from 0, 1, 2, 3, 4, 5)"],
    ["csvsql", ["-i", ""], "argument -i/--dialect: invalid choice: '' (choose from mssql, mysql, oracle, postgresql, sqlite)"],
    ["in2csv", ["-f=x"], "argument -f/--format: invalid choice: 'x' (choose from csv, dbf, fixed, geojson, json, ndjson, xls, xlsx)"]
  ] as const;
  for (const [command, argv, message] of cases) {
    assert.deepEqual(await parseArguments(command, bytes(argv), { limits }), {
      kind: "exit", status: 2, stdout: "",
      stderr: commands.find(item => item.name === command)!.usage + `${command}: error: ${message}\n`
    });
  }
});

test("frozen CPython integer digit limit includes zeroes and excludes separators", async () => {
  for (const value of ["1".repeat(4301), "0".repeat(4301), "١".repeat(4301)]) {
    const result = await parseArguments("csvcut", bytes(["-K", value]), { limits });
    assert.deepEqual(result, { kind: "exit", status: 2, stdout: "", stderr:
      commands.find(command => command.name === "csvcut")!.usage +
      `csvcut: error: argument -K/--skip-lines: invalid int value: '${value}'\n` });
  }
  const result = await parseArguments("csvcut", bytes(["-K", "+" + "0_".repeat(4299) + "0"]), { limits });
  if (result.kind !== "parsed") assert.fail(result.stderr);
  assert.equal(result.options.skip_lines, 0);
  await result.dispose();
});

test("Python integer conversion accepts Unicode decimal digits and NEL whitespace", async () => {
  for (const value of ["١٢", "１２", "\u008512", "𝟙𝟚"]) {
    const result = await parseArguments("csvcut", bytes(["-K", value]), { limits });
    if (result.kind !== "parsed") assert.fail(result.stderr);
    assert.equal(result.options.skip_lines, 12);
  }
  for (const value of ["\ufeff12", "\u001c12"]) {
    const result = await parseArguments("csvcut", bytes(["-K", value]), { limits });
    if (result.kind !== "exit") assert.fail("expected invalid integer");
    assert.equal(result.status, 2);
  }
});

test("Python diagnostic repr escapes malformed argv bytes and nonprinting characters", async () => {
  const result = await parseArguments("csvcut", [bytes(["-K"])[0]!, Uint8Array.of(0xff)], { limits });
  if (result.kind !== "exit") assert.fail("expected invalid integer");
  assert.ok(result.stderr.endsWith("csvcut: error: argument -K/--skip-lines: invalid int value: '\\udcff'\n"));
  const nel = await parseArguments("in2csv", bytes(["-f", "\u0085"]), { limits });
  if (nel.kind !== "exit") assert.fail("expected invalid choice");
  assert.ok(nel.stderr.includes("invalid choice: '\\x85'"));
});

test("original executable version exits use the command name and separate channels", async () => {
  for (const command of "csvclean csvcut csvformat csvgrep csvjoin csvjson csvlook csvpy csvsort csvsql csvstack csvstat in2csv sql2csv".split(" ")) {
    assert.deepEqual(await parseArguments(command, bytes(["-V"]), { limits }), {
      kind: "exit", status: 0, stdout: `${command} 2.2.0\n`, stderr: ""
    });
  }
});

test("command-specific short options and overrides retain original meaning", async () => {
  const result = await parseArguments("csvstack", bytes(["-n", "year", "-g", "2020,2021", "a.csv", "b.csv"]), { limits });
  assert.equal(result.kind, "parsed");
  if (result.kind !== "parsed") return;
  assert.equal(result.options.group_name, "year");
  assert.deepEqual(result.options.input_paths, ["a.csv", "b.csv"]);
  const bad = await parseArguments("csvcut", bytes(["--no-inference"]), { limits });
  assert.equal(bad.kind, "exit");
  if (bad.kind === "exit") {
    assert.equal(bad.status, 2);
    assert.ok(bad.stderr.endsWith("csvcut: error: unrecognized arguments: --no-inference\n"));
  }
});

test("clusters, attached options, equals, abbreviation and terminator follow argparse", async () => {
  const result = await parseArguments("csvcut", bytes(["-txc2", "--enc=utf-8", "--", "-input.csv"]), { limits });
  assert.equal(result.kind, "parsed");
  if (result.kind !== "parsed") return;
  assert.equal(result.options.tabs, true);
  assert.equal(result.options.delete_empty, true);
  assert.equal(result.options.columns, "2");
  assert.equal(result.options.encoding, "utf-8");
  assert.equal(result.options.input_path, "-input.csv");
});

test("nargs values replace stored lists and append pairs without leaking defaults", async () => {
  const args = ["--engine-option", "echo", "True", "--engine-option", "pool_size", "2", "--null-value", "x", "y", "--null-value", "z", "--query", "select 1", "--query=select 2"];
  const result = await parseArguments("csvsql", bytes(args), { limits });
  assert.equal(result.kind, "parsed");
  if (result.kind !== "parsed") return;
  assert.deepEqual(result.options.engine_option, [["echo", "True"], ["pool_size", "2"]]);
  assert.deepEqual(result.options.null_values, ["z"]);
  assert.deepEqual(result.options.queries, ["select 1", "select 2"]);
  const next = await parseArguments("csvsql", bytes([]), { limits });
  if (next.kind !== "parsed") assert.fail("expected parsed defaults");
  assert.deepEqual(next.options.engine_option, []);
  assert.deepEqual(next.options.input_paths, ["-"]);
});

test("negative numbers are values, profile quoting includes choices 4 and 5", async () => {
  const result = await parseArguments("csvformat", bytes(["-K-1", "-u", "5", "-U4"]), { limits });
  if (result.kind !== "parsed") assert.fail(result.stderr);
  assert.equal(result.options.skip_lines, -1);
  assert.equal(result.options.quoting, 5);
  assert.equal(result.options.out_quoting, 4);
});

test("FileType opens match files before subsequent actions and keeps failures as parser errors", async () => {
  const opened: string[] = [];
  const result = await parseArguments("csvgrep", bytes(["-f", "missing", "--help"]), {
    limits,
    async openMatchFile(path) { opened.push(path); throw new Error("No such file or directory"); }
  });
  assert.deepEqual(opened, ["missing"]);
  if (result.kind !== "exit") assert.fail("expected parser error");
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("argument -f/--file: can't open 'missing'"));
});

test("explicit help/version arguments fail before the exit action", async () => {
  for (const [token, label] of [["--help=x", "-h/--help"], ["--version=", "-V/--version"]]) {
    const result = await parseArguments("csvjoin", bytes([token!]), { limits });
    if (result.kind !== "exit") assert.fail("expected parser exit");
    assert.equal(result.status, 2);
    assert.ok(result.stderr.endsWith(`csvjoin: error: argument ${label}: ignored explicit argument '${token!.slice(token!.indexOf("=") + 1)}'\n`));
  }
  const clustered = await parseArguments("csvjoin", bytes(["-hX"]), { limits });
  assert.equal(clustered.kind === "exit" && clustered.status, 0);
});

test("explicit nargs-plus binds one value and leaves following tokens positional", async () => {
  const result = await parseArguments("csvjoin", bytes(["--null-value=x", "file.csv"]), { limits });
  if (result.kind !== "parsed") assert.fail(result.stderr);
  assert.deepEqual(result.options.null_values, ["x"]);
  assert.deepEqual(result.options.input_paths, ["file.csv"]);
});

test("positional nargs-star consumes the terminator within its contiguous group", async () => {
  const result = await parseArguments("csvjoin", bytes(["a", "--", "-b", "c"]), { limits });
  if (result.kind !== "parsed") assert.fail(result.stderr);
  assert.deepEqual(result.options.input_paths, ["a", "-b", "c"]);
  const split = await parseArguments("csvjoin", bytes(["a", "-t", "b"]), { limits });
  if (split.kind !== "exit") assert.fail("expected unrecognized positional");
  assert.ok(split.stderr.endsWith("unrecognized arguments: b\n"));
});

test("negative decimals with a trailing dot reach integer conversion", async () => {
  const result = await parseArguments("csvjoin", bytes(["-K", "-1."]), { limits });
  if (result.kind !== "exit") assert.fail("expected invalid integer");
  assert.ok(result.stderr.endsWith("argument -K/--skip-lines: invalid int value: '-1.'\n"));
});

test("match-file cancellation remains cancellation on both resolution and rejection", async () => {
  for (const fail of [false, true]) {
    const controller = new AbortController();
    const reason = new Error("cancel match-file");
    await assert.rejects(parseArguments("csvgrep", bytes(["-f", "matches"]), {
      limits, signal: controller.signal,
      async openMatchFile() {
        controller.abort(reason);
        if (fail) throw new Error("file read failed");
        return { async *lines() { yield "match\n"; }, async close() {} };
      }
    }), error => error === reason);
  }
});

test("argv decoding preserves malformed bytes with the frozen native surrogateescape profile", async () => {
  const samples = [
    [Uint8Array.of(0xff, 0x61, 0xc3, 0xa9), "\udcffaé"],
    [Uint8Array.of(0xed, 0xa0, 0x80), "\udced\udca0\udc80"],
    [Uint8Array.of(0xe2, 0x82), "\udce2\udc82"],
    [Uint8Array.of(0xef, 0xbb, 0xbf, 0xf0, 0x9f, 0x98, 0x80), "\ufeff😀"],
    [Uint8Array.of(0xe0, 0x80, 0x80, 0xf4, 0x90, 0x80, 0x80), "\udce0\udc80\udc80\udcf4\udc90\udc80\udc80"]
  ] as const;
  for (const [argument, expected] of samples) {
    const result = await parseArguments("csvcut", [argument], { limits });
    if (result.kind !== "parsed") assert.fail(result.stderr);
    assert.equal(result.options.input_path, expected);
  }
});

test("negative Unicode decimal argv values reach integer conversion", async () => {
  for (const [value, expected] of [["-١", -1], ["-𝟙", -1], ["-１２", -12]] as const) {
    const result = await parseArguments("csvcut", bytes(["-K", value]), { limits });
    if (result.kind !== "parsed") assert.fail(result.stderr);
    assert.equal(result.options.skip_lines, expected);
  }
  const decimal = await parseArguments("csvcut", bytes(["-K", "-.١"]), { limits });
  if (decimal.kind !== "exit") assert.fail("expected invalid integer");
  assert.ok(decimal.stderr.endsWith("argument -K/--skip-lines: invalid int value: '-.١'\n"));
});
