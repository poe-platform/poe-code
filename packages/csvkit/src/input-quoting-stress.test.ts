import { test, expect } from "vitest";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";

async function invoke(command: string, input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides,
  };
  try { return { status: await execute(command, context), stdout, stderr }; }
  finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

test("typed quoting awaits header sink before reporting a later blocker and closes its input iterator", async () => {
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let advances = 0; let finalized = false;
  const writes: string[] = [];
  const pending = invoke("csvcut", "", ["-u", "2"], {
    stdin: (async function* () {
      try {
        advances++; yield new TextEncoder().encode('"a","b"\n');
        advances++; yield new TextEncoder().encode("1,2\n");
      } finally { finalized = true; }
    })(),
    stdout: { write: async bytes => { writes.push(new TextDecoder().decode(bytes)); entered(); await blocked; } },
  });
  await Promise.race([started, pending.then(result => { throw new Error(JSON.stringify(result)); })]);
  expect(writes).toEqual(["a,b\n"]);
  release();
  expect(await pending).toEqual({ stdout: "", stderr: "csvkit: unsupported or unqualified: input quoting mode 2 numeric/null operation cells\n", status: 78 });
  expect(advances).toBe(2);
  expect(finalized).toBe(true);
});

for (const mode of [2, 4, 5]) {
  for (const command of ["csvcut", "csvformat", "csvclean", "csvsort"]) test(`${command} quoting ${mode} preserves all-string records`, async () => {
    const flags = command === "csvclean" ? ["--length-mismatch"] : command === "csvsort" ? ["-I", "-y", "0"] : [];
    expect(await invoke(command, '"a","b"\n"x","y"\n', ["-u", String(mode), ...flags])).toEqual({
      stdout: "a,b\nx,y\n", stderr: "", status: 0,
    });
  });
}

for (const mode of [2, 4]) test(`input quoting ${mode} reports original unquoted text conversion failure`, async () => {
  expect(await invoke("csvcut", "a,b\nx,y\n", ["-u", String(mode)])).toEqual({
    stdout: "", stderr: "ValueError: could not convert string to float: 'a'\n", status: 1,
  });
});

// These remain honest blockers: preserving strings must never coerce typed cells.
for (const [mode, input] of [[2, '"a","b"\n1,2\n'], [4, '"a","b"\n1,\n'], [5, '"a","b"\nx,\n']] as const) {
  test(`input quoting ${mode} blocks typed records after preserving prior raw output`, async () => {
    expect(await invoke("csvcut", input, ["-u", String(mode)])).toEqual({
      stdout: "a,b\n", stderr: `csvkit: unsupported or unqualified: input quoting mode ${mode} numeric/null operation cells\n`, status: 78,
    });
  });
}
