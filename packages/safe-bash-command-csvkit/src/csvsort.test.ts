import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { csvsort } from "./commands/csvsort.js";
import reference from "../../../docs/csvkit/csvsort-reference.json" with { type: "json" };

async function invoke(input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}, settings?: Readonly<Record<string, unknown>>) {
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
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale call"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = settings ? await run({ command: "csvsort", settings }, context) : await execute("csvsort", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

for (const [index, item] of reference.cases.entries()) {
  test(`csvsort frozen original differential ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv, { columnWarnings: { utilsPath: reference.warningUtilsPath } }), {
      stdout: item.stdout, stderr: item.stderr, status: item.status
    });
  });
}

test("csvsort Python uppercase expands Unicode keys and preserves equal-key order", async () => {
  assert.deepEqual(await invoke("k,id\nß,first\nss,second\nſ,last\ns,before\nﬃ,ligature\nFFI,plain\n", ["-y0", "-I", "-i", "-c", "k"]), {
    stdout: "k,id\nﬃ,ligature\nFFI,plain\nſ,last\ns,before\nß,first\nss,second\n", stderr: "", status: 0
  });
});

test("csvsort Decimal NaN traps only when a selected tuple needs comparison", async () => {
  assert.deepEqual(await invoke("x\nNaN\n2\n", ["-y0"]), { stdout: "", stderr: "InvalidOperation: [<class 'decimal.InvalidOperation'>]\n", status: 1 });
  assert.deepEqual(await invoke("x\nNaN\n", ["-y0"]), { stdout: "x\nNaN\n", stderr: "", status: 0 });
  assert.deepEqual(await invoke("k,x\na,NaN\nb,2\n", ["-y0", "-c", "k"]), { stdout: "k,x\na,NaN\nb,2\n", stderr: "", status: 0 });
});

test("csvsort original large integer regression orders numbers rather than their spelling", async () => {
  const values = Array.from({ length: 512 }, (_, index) => String(511 - index));
  const expected = Array.from({ length: 512 }, (_, index) => String(index));
  assert.deepEqual(await invoke("n\n" + values.join("\n") + "\n", ["-y0"]), { stdout: "n\n" + expected.join("\n") + "\n", stderr: "", status: 0 });
});

test("csvsort reverse NullOrder and duplicate selected keys stay stable through SDK", async () => {
  assert.deepEqual(await invoke("k,id\n2,a\nnull,b\n2,c\n10,d\nnull,e\n", [], {}, { sniff_limit: 0, columns: "k,k", reverse: true }), {
    stdout: "k,id\n,b\n,e\n10,d\n2,a\n2,c\n", stderr: "", status: 0
  });
});

test("csvsort exact flags are collision free and retain source-local meanings", () => {
  const actual = csvsort.actions.flatMap(action => action.optionStrings).sort();
  const expected = "-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version -n --names -c --columns -r --reverse -i --ignore-case -y --snifflimit -I --no-inference".split(" ").sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  for (const [flag, dest] of [["-r", "reverse"], ["-i", "ignore_case"], ["-y", "sniff_limit"], ["-I", "no_inference"]]) {
    assert.equal(csvsort.actions.find(action => action.optionStrings.some(value => value === flag))?.dest, dest);
  }
});

test("csvsort deduplicates headers in source order with injected warning identity", async () => {
  const overrides = { columnWarnings: { utilsPath: "/reference/agate/utils.py" } } as Partial<CsvkitContext>;
  assert.deepEqual(await invoke("a,a,a_2,\nx,y,z,q\n", ["-y0", "-I"], overrides), {
    stdout: "a,a_2,a_2_2,d\nx,y,z,q\n", status: 0,
    stderr: '/reference/agate/utils.py:288: DuplicateColumnWarning: Column name "a" already exists in Table. Column will be renamed to "a_2".\n  warn_duplicate_column(new_value, final_value)\n/reference/agate/utils.py:288: DuplicateColumnWarning: Column name "a_2" already exists in Table. Column will be renamed to "a_2_2".\n  warn_duplicate_column(new_value, final_value)\n/reference/agate/utils.py:272: UnnamedColumnWarning: Column 3 has no name. Using "d".\n  warn_unnamed_column(i, new_value)\n'
  });
});

test("csvsort names return raw headers before inference and body consumption", async () => {
  assert.deepEqual(await invoke("a,a,\ninvalid,extra,body,cell\n", ["-n", "--zero", "--locale", "unsupported"]), {
    stdout: "  0: a\n  1: a\n  2: \n", stderr: "", status: 0
  });
});

test("csvsort awaits output backpressure before advancing to the next row", async () => {
  const writes: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const pending = invoke("n\n10\n2\n", ["-y0"], { stdout: { write: async bytes => {
    writes.push(new TextDecoder().decode(bytes));
    if (writes.length === 1) { entered(); await blocked; }
  } } });
  await started;
  assert.deepEqual(writes, ["n\n"]);
  release();
  assert.deepEqual(await pending, { stdout: "", stderr: "", status: 0 });
  assert.deepEqual(writes, ["n\n", "2\n", "10\n"]);
});

test("csvsort preserves cancellation identity and finalizes borrowed input without further output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel csvsort");
  let finalized = 0; let writes = 0;
  await assert.rejects(invoke("", ["-y0"], {
    signal: controller.signal,
    stdin: (async function* () { try { yield new TextEncoder().encode("n\n10\n2\n"); } finally { finalized++; } })(),
    stdout: { write: async () => { writes++; controller.abort(reason); } }
  }), error => error === reason);
  assert.equal(finalized, 1);
  assert.equal(writes, 1);
});

test("csvsort compares supplementary text by Python scalar order and retains uppercase ties", async () => {
  assert.deepEqual(await invoke("k,id\n𐐨,lower\n\ue000,bmp\n𐐀,upper\n", ["-y0", "-I", "-i", "-c", "k"]), {
    stdout: "k,id\n\ue000,bmp\n𐐨,lower\n𐐀,upper\n", stderr: "", status: 0
  });
});

test("csvsort timezone instants and microseconds determine order with stable equal instants", async () => {
  const input = "d,id\n2024-01-01T01:00:00.000000+0100,first\n2024-01-01T00:00:00.000001+0000,later\n2024-01-01T00:00:00.000000+0000,equal\n2023-12-31T23:59:59.999999+0000,earlier\n";
  assert.deepEqual(await invoke(input, ["-y0", "--datetime-format", "%Y-%m-%dT%H:%M:%S.%f%z", "-c", "d"]), {
    stdout: "d,id\n2023-12-31T23:59:59.999999+00:00,earlier\n2024-01-01T01:00:00+01:00,first\n2024-01-01T00:00:00+00:00,equal\n2024-01-01T00:00:00.000001+00:00,later\n", stderr: "", status: 0
  });
});

test("csvsort equal Decimal scales continue to later tuple fields and signed zeros stay stable", async () => {
  const input = "n,k,id\n2.00,z,first\n-0,a,negative\n0,a,positive\n2,a,second\n2.0,a,third\n";
  assert.deepEqual(await invoke(input, ["-y0", "-c", "n,k", "-r"]), {
    stdout: "n,k,id\n2.00,z,first\n2,a,second\n2.0,a,third\n-0,a,negative\n0,a,positive\n", stderr: "", status: 0
  });
});

test("csvsort names finalize after the first decoder window without requesting later chunks", async () => {
  let finalized = 0; let advanced = 0;
  assert.deepEqual(await invoke("", ["-n", "-y0"], {
    stdin: (async function* () {
      try {
        // The frozen TextIO profile reads in 8192-byte windows. The malformed
        // body in this window must remain unparsed, and later windows unread.
        yield new TextEncoder().encode("a,b\n" + "x".repeat(8188));
        advanced++;
        throw new Error("names must not consume body");
      } finally { finalized++; }
    })()
  }), { stdout: "  1: a\n  2: b\n", stderr: "", status: 0 });
  assert.equal(advanced, 0);
  assert.equal(finalized, 1);
});
