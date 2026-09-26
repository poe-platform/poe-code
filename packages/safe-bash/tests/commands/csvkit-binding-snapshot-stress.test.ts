import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvkit factory retains the admitted input-open capability after options replacement", async () => {
  const effects: unknown[] = [];
  const options = { ...bindings, probeInputOpen: async (path: string, settings: { cwd: string; signal: AbortSignal }) => {
    settings.signal.throwIfAborted();
    effects.push([path, settings.cwd]);
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/work" }).use(csvkitCommands(options));
  options.probeInputOpen = async () => { assert.fail("replacement capability was never admitted by the factory"); };
  try {
    const result = await shell.exec("csvlook -I -y 0 -H --max-rows 0 source.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "||\n|  |\n", stderr: "", status: 0 });
    assert.deepEqual(effects, [["source.csv", "/work"]]);
  } finally { await shell.dispose(); }
});

test("csvkit factory owns optional warning profiles independently of caller mutations", async () => {
  const warning = { path: "/reference/agate/csv_py3.py", line: 84, source: "warnings.warn(message, RuntimeWarning)" };
  const sniffing = { warning, suppressWarnings: false };
  const options = { ...bindings, sniffing };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  warning.path = "/replacement.py";
  warning.line = 1;
  sniffing.suppressWarnings = true;
  options.sniffing = { warning: { path: "/other.py", line: 2, source: "changed()" }, suppressWarnings: true };
  try {
    const result = await shell.exec("in2csv -I -f csv", { stdin: "name\nvalue\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "name\nvalue\n", status: 0,
      stderr: "/reference/agate/csv_py3.py:84: RuntimeWarning: Error sniffing CSV dialect: Could not determine delimiter\n  warnings.warn(message, RuntimeWarning)\n"
    });
  } finally { await shell.dispose(); }
});

test("csvkit factory retains column-warning provenance and suppression policy", async () => {
  const columnWarnings = { utilsPath: "/reference/agate/utils.py", suppressWarnings: false };
  const options = { ...bindings, columnWarnings };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  columnWarnings.utilsPath = "/replacement/utils.py";
  columnWarnings.suppressWarnings = true;
  options.columnWarnings = { utilsPath: "/other/utils.py", suppressWarnings: true };
  try {
    const result = await shell.exec("in2csv -I -f json", { stdin: "[{},{}]" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "\n\n\n", status: 0,
      stderr: '/reference/agate/table/from_object.py:93: RuntimeWarning: Column names not specified. "()" will be used as names.\n  return Table(rows, column_names, row_names=row_names, column_types=column_types)\n'
    });
  } finally { await shell.dispose(); }
});

test("csvkit collision preflight leaves the complete host registry untouched for every executable", async () => {
  const names = ["csvclean", "csvcut", "csvformat", "csvgrep", "csvjoin", "csvjson", "csvlook", "csvpy", "csvsort", "csvsql", "csvstack", "csvstat", "in2csv", "sql2csv"];
  for (const name of names) {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    try {
      shell.commands.register({ name, execute: async () => ({ exitCode: 19 }) });
      const before = shell.commands.list();
      assert.throws(() => csvkitCommands(bindings).setup(shell), { message: `Command already registered: ${name}` });
      assert.deepEqual(shell.commands.list(), before);
      assert.equal((await shell.exec(name)).exitCode, 19);
    } finally { await shell.dispose(); }
  }
});

for (const [name, command, input, expected] of [
  ["earlier text removes temporal hypotheses", "csvjson -y 0", "d\nordinary text\n1 ſec\n", {
    stdout: '[{"d": "ordinary text"}, {"d": "1 ſec"}]', stderr: "", status: 0
  }],
  ["later text cannot erase an earlier hypothesis diagnostic", "csvjson -y 0", "d\n1 ſec\nordinary text\n", {
    stdout: "", stderr: "KeyError: 'ſec'\n", status: 1
  }],
  ["elimination in one column does not remove another column's hypotheses", "csvjson -y 0", "a,b\nordinary text,1 ſec\n", {
    stdout: "", stderr: "KeyError: 'ſec'\n", status: 1
  }],
  ["earlier text eliminates temporal hypotheses separately in every column", "csvjson -y 0", "a,b\nordinary text,other text\n1 ſec,1 mın\n", {
    stdout: '[{"a": "ordinary text", "b": "other text"}, {"a": "1 ſec", "b": "1 mın"}]', stderr: "", status: 0
  }],
  ["null rows preserve temporal hypotheses", "csvjson -y 0", "d\nNA\n1 ſec\n", {
    stdout: "", stderr: "KeyError: 'ſec'\n", status: 1
  }],
  ["no inference bypasses temporal hypotheses in every column", "csvjson -I -y 0", "a,b\n1 ſec,1 mın\n", {
    stdout: '[{"a": "1 ſec", "b": "1 mın"}]', stderr: "", status: 0
  }],
  ["elimination persists through a padded missing value", "csvjson -y 0", "a,b\nordinary text,other text\nplain\n1 ſec,1 mın\n", {
    stdout: '[{"a": "ordinary text", "b": "other text"}, {"a": "plain", "b": null}, {"a": "1 ſec", "b": "1 mın"}]', stderr: "", status: 0
  }],
  ["serialized comma interval survives rejected temporal hypotheses", "csvjson -y 0", 'd\n"2 days, 3:04:05"\n', {
    stdout: '[{"d": "2 days, 3:04:05"}]', stderr: "", status: 0
  }],
  ["numeric locale does not configure unused temporal hypotheses", "csvsort -y 0 -L de_DE", 'a\n"1,5"\n"2,5"\n', {
    stdout: "a\n1.5\n2.5\n", stderr: "", status: 0
  }],
  ["numeric locale preserves default date parser locale", "csvjson -y 0 -L de_DE", "a\n2024-01-01\n", {
    stdout: '[{"a": "2024-01-01"}]', stderr: "", status: 0
  }]
] as const) test(`csvkit inference stress: ${name}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec(command, { stdin: input });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, expected);
  } finally { await shell.dispose(); }
});
