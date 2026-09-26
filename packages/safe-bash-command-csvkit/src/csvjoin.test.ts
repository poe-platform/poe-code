import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { csvjoin } from "./commands/csvjoin.js";
import reference from "../../../docs/csvkit/join-operation-reference.json" with { type: "json" };
import typedReference from "../../../docs/csvkit/csvjoin-reference.json" with { type: "json" };
import userReference from "../../../docs/csvkit/csvjoin-user-edge-reference.json" with { type: "json" };

async function invoke(files: Readonly<Record<string, string>>, argv: readonly string[], input = "", overrides: Partial<CsvkitContext> = {}, settings?: Readonly<Record<string, unknown>>) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async path => { assert.ok(path in files); return new TextEncoder().encode(files[path]); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale call"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = settings ? await run({ command: "csvjoin", settings }, context) : await execute("csvjoin", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

for (const [index, item] of reference.cases.entries()) test(`csvjoin frozen original differential ${index}`, async () => {
  assert.deepEqual(await invoke(item.files, item.argv, item.stdin), { stdout: item.stdout, stderr: item.stderr, status: item.status });
});

for (const [index, item] of typedReference.cases.entries()) test(`csvjoin typed frozen differential ${index}`, async () => {
  assert.deepEqual(await invoke(item.files, item.argv, item.stdin, { columnWarnings: { utilsPath: typedReference.warningUtilsPath } }), { stdout: item.stdout, stderr: item.stderr, status: item.status });
});

for (const [index, item] of userReference.cases.entries()) test(`csvjoin user edge frozen differential ${index}`, async () => {
  assert.deepEqual(await invoke(item.files, item.argv, item.stdin, { columnWarnings: { utilsPath: userReference.warningUtilsPath } }), { stdout: item.stdout, stderr: item.stderr, status: item.status });
});

test("csvjoin SDK shares join execution and output awaits backpressure", async () => {
  const writes: string[] = [];
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const pending = invoke({ "/a": "k,a\nx,A\n", "/b": "k,b\nx,B\n" }, ["a", "b"], "", {
    stdout: { write: async bytes => { writes.push(new TextDecoder().decode(bytes)); if (writes.length === 1) { entered(); await blocked; } } }
  }, { input_paths: ["a", "b"], sniff_limit: 0, no_inference: true, columns: "k" });
  await Promise.race([started, pending.then(result => { throw new Error(JSON.stringify(result)); })]);
  assert.deepEqual(writes, ["k,a,b\n"]);
  release();
  assert.deepEqual(await pending, { stdout: "", stderr: "", status: 0 });
  assert.deepEqual(writes, ["k,a,b\n", "x,A,B\n"]);
});

test("csvjoin preserves cancellation identity and closes input before emitting more", async () => {
  const controller = new AbortController(); const reason = new Error("cancel csvjoin");
  let finalized = 0; let writes = 0;
  await assert.rejects(invoke({}, ["-y0"], "", {
    signal: controller.signal,
    stdin: (async function* () { try { yield new TextEncoder().encode("n\n2\n3\n"); } finally { finalized++; } })(),
    stdout: { write: async () => { writes++; controller.abort(reason); } }
  }), error => error === reason);
  assert.equal(finalized, 1); assert.equal(writes, 1);
});

test("csvjoin bounds Cartesian result materialization before any stdout", async () => {
  const result = await invoke({ "/a": "k,a\nx,A\nx,B\nx,C\n", "/b": "k,b\nx,D\nx,E\nx,F\n" }, ["-y0", "-I", "-c", "k", "a", "b"], "", { limits: { ...defaultLimits, maxRows: 8 } });
  assert.deepEqual(result, { stdout: "", stderr: "csvkit: unsupported or unqualified: join result row budget exceeded\n", status: 78 });
});

test("csvjoin original regression parses and reserializes a single typed table", async () => {
  assert.deepEqual(await invoke({}, ["-y0"], "n,b\n02,yes\n3,no\n"), { stdout: "n,b\n2,True\n3,False\n", stderr: "", status: 0 });
});

test("csvjoin independently inferred numeric and Boolean keys share Python equality", async () => {
  assert.deepEqual(await invoke({ "/a": "k,a\n1,one\n0,zero\n", "/b": "k,b\n1.00,first\n2,other\n-0,last\n" }, ["-y0", "-c", "k", "a", "b"]), {
    stdout: "k,a,b\nTrue,one,first\nFalse,zero,last\n", stderr: "", status: 0
  });
});

test("csvjoin flags exactly match inherited and local grammar without collisions", () => {
  const flags = csvjoin.actions.flatMap(action => action.optionStrings).sort();
  assert.deepEqual(flags, "-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version -c --columns --outer --left --right -y --snifflimit -I --no-inference".split(" ").sort());
  assert.equal(new Set(flags).size, flags.length);
});
