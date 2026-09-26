import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import reference from "../../../docs/csvkit/raw-operation-reference.json" with { type: "json" };
import { csvgrep } from "./commands/csvgrep.js";

async function invoke(input: string, argv: readonly string[], settings?: Readonly<Record<string, unknown>>, lines?: readonly string[]) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
    openMatchFile: async () => ({ lines: async function* () { for (const line of lines ?? []) yield line; }, close: async () => {} }),
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  try {
    const status = settings ? await run({ command: "csvgrep", settings }, context) : await execute("csvgrep", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

for (const [index, item] of reference.cases.entries()) {
  if (item.command !== "csvgrep") continue;
  test(`csvgrep frozen raw observation ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvgrep match files use Python rstrip and exact membership including missing cells", async () => {
  assert.deepEqual(await invoke("a,b\nx,y\nz\nx ,y\n", ["-c", "2", "-f", "matches"], undefined, ["y \t\n", "\n"]), {
    stdout: "a,b\nx,y\nz\nx ,y\n", stderr: "", status: 0
  });
});

test("csvgrep empty match files remain callable patterns rather than omitted patterns", async () => {
  assert.deepEqual(await invoke("a\nx\n", ["-c", "1", "-f", "matches"]), { stdout: "a\n", stderr: "", status: 0 });
});

test("csvgrep empty strings omit patterns for both aggregate modes", async () => {
  assert.deepEqual(await invoke("a\nx\n", ["-c", "1", "-m", "", "-a"]), { stdout: "a\n", stderr: "", status: 0 });
});

test("csvgrep flags are collision free and exclude inference and locale flags", () => {
  const flags = csvgrep.actions.flatMap(action => action.optionStrings);
  assert.equal(new Set(flags).size, flags.length);
  for (const flag of ["-L", "--locale", "-I", "--no-inference", "--snifflimit", "-C"]) assert.equal(flags.includes(flag), false);
  assert.equal(csvgrep.actions.find(action => action.optionStrings.some(flag => flag === "-f"))?.dest, "matchfile");
});

test("csvgrep regex searches take precedence over substring and matchfile", async () => {
  assert.deepEqual(await invoke("a\nfoo12\nbar\n", ["-c", "1", "-r", "[0-9]+$", "-m", "bar", "-f", "matches"], undefined, ["bar"]), {
    stdout: "a\nfoo12\n", stderr: "", status: 0
  });
});

test("csvgrep regex Unicode digits and Python absolute-end anchor", async () => {
  assert.deepEqual(await invoke('a\n١\n"1\n"\n', ["-c", "1", "-r", "\\d\\Z"]), { stdout: "a\n١\n", stderr: "", status: 0 });
});

test("csvgrep SDK uses the same injected matchfile engine as argv", async () => {
  assert.deepEqual(await invoke("a\nx\ny\n", [], { columns: "a", matchfile: "matches" }, ["x\n"]), { stdout: "a\nx\n", stderr: "", status: 0 });
});

test("csvgrep Python search handles grouping, alternatives, boundaries and flags", async () => {
  for (const [regex, stdout] of [
    ["(?:foo|bar){1,2}$", 'a\nfoo\nbarbar\n'],
    ["(?i)\\bfoo\\b", 'a\nfoo\nFOO\n'],
    ["(?s)^a.b$", 'a\n"a\nb"\n'],
    ["(?m)^b$", 'a\n"a\nb"\n'],
    ["[^a-z]+\\Z", 'a\nFOO\n123\n']
  ]) assert.deepEqual(await invoke('a\nfoo\nbarbar\nFOO\n123\n"a\nb"\n', ["-c", "1", "-r", regex!]), { stdout, stderr: "", status: 0 });
});

test("csvgrep unsupported regex constructs and work exhaustion remain blockers", async () => {
  for (const regex of ["(?<=x*)y", "(a)\\1", "(?P<name>a)", "a++"]) {
    const result = await invoke("a\nxy\naaa\n", ["-c", "1", "-r", regex]);
    assert.equal(result.status, 78);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported or unqualified/);
  }
});

test("csvgrep argv and SDK share Python lookaround and Unicode escape search", async () => {
  const input = "a\nfoobar\nfoobaz\nbar\n😀b\n";
  for (const [regex, stdout] of [
    ["(?<=foo)bar", "a\nfoobar\n"],
    ["foo(?!bar)", "a\nfoobaz\n"],
    [String.raw`(?<=\U0001f600)b`, "a\n😀b\n"]
  ]) {
    const expected = { stdout, stderr: "", status: 0 };
    assert.deepEqual(await invoke(input, ["-c", "1", "-r", regex!]), expected);
    assert.deepEqual(await invoke(input, [], { columns: "1", regex }), expected);
  }
});

test("csvgrep argv and SDK share omitted minima and consecutive global flags", async () => {
  for (const regex of ["(?i)(?i)^a{,2}$", "(?a)(?i)^a{,2}?$"]) {
    const expected = { stdout: "a\nA\naa\n", stderr: "", status: 0 };
    const input = "a\nA\naa\naaa\nb\n";
    assert.deepEqual(await invoke(input, ["-c", "1", "-r", regex]), expected);
    assert.deepEqual(await invoke(input, [], { columns: "1", regex }), expected);
  }
});

test("csvgrep empty string and regex truthiness cover both aggregate modes and inversion", async () => {
  for (const patternFlag of ["-m", "-r"]) {
    for (const any of [false, true]) for (const inverse of [false, true]) {
      const argv = ["-c", "a,b", patternFlag, "", ...(any ? ["-a"] : []), ...(inverse ? ["-i"] : [])];
      assert.deepEqual(await invoke("a,b\nx,y\nz\n", argv), {
        stdout: "a,b\n" + (any === inverse ? "x,y\nz\n" : ""), stderr: "", status: 0
      }, JSON.stringify(argv));
    }
  }
});

test("csvgrep falsey regex falls through to file then substring", async () => {
  assert.deepEqual(await invoke("a\nx\ny\n", ["-c", "1", "-r", "", "-m", "y", "-f", "matches"], undefined, ["x"]), {
    stdout: "a\nx\n", stderr: "", status: 0
  });
  assert.deepEqual(await invoke("a\nx\ny\n", ["-c", "1", "-r", "", "-m", "y"]), {
    stdout: "a\ny\n", stderr: "", status: 0
  });
});

test("csvgrep selected duplicates collapse and reversed ranges keep vacuous aggregate semantics", async () => {
  for (const columns of ["a,a,1", "2-1"]) for (const any of [false, true]) for (const inverse of [false, true]) {
    const input = "a,b\nx,y\nz,x\n";
    const data = columns === "2-1" ? (any === inverse ? "x,y\nz,x\n" : "") : (inverse ? "z,x\n" : "x,y\n");
    assert.deepEqual(await invoke(input, ["-c", columns, "-m", "x", ...(any ? ["-a"] : []), ...(inverse ? ["-i"] : [])]), {
      stdout: "a,b\n" + data, stderr: "", status: 0
    });
  }
});

test("csvgrep numbering counts multiline records physically before filtering", async () => {
  assert.deepEqual(await invoke('a,b\n"drop\ncontinued",x\nkeep,y\n', ["-l", "-c", "1", "-m", "keep"]), {
    stdout: "line_numbers,a,b\n3,keep,y\n", stderr: "", status: 0
  });
  assert.deepEqual(await invoke("drop,x\nkeep,y\n", ["-H", "-l", "-c", "1", "-m", "keep"]), {
    stdout: "a,b,c\n2,keep,y\n", stderr: "", status: 0
  });
});
