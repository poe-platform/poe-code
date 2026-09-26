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

test("typed quoting awaits header sink before writing typed rows and closes its input iterator", async () => {
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
  expect(await pending).toEqual({ stdout: "", stderr: "", status: 0 });
  expect(writes).toEqual(["a,b\n", "1.0,2.0\n"]);
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

// Typed readers retain float and null semantics through projection and writing.
for (const [mode, input] of [[2, '"a","b"\n1,2\n'], [4, '"a","b"\n1,\n'], [5, '"a","b"\nx,\n']] as const) {
  test(`input quoting ${mode} writes typed records after preserving prior raw output`, async () => {
    expect(await invoke("csvcut", input, ["-u", String(mode)])).toEqual({
      stdout: mode === 2 ? "a,b\n1.0,2.0\n" : mode === 4 ? "a,b\n1.0,\n" : "a,b\nx,\n", stderr: "", status: 0,
    });
  });
}

for (const mode of [2, 4, 5]) {
  for (const command of ["csvcut", "csvformat"]) test(`${command} quoting ${mode} accepts issue 524 CRLF cells`, async () => {
    const input = mode === 5 ? "label,n\r\nChangedGamma,\r\nChangedDelta,\r\n" : '"label","n"\r\n"ChangedGamma",12\r\n"ChangedDelta",14\r\n';
    const argv = ["--quoting", String(mode), ...(command === "csvcut" ? ["-c", "label"] : [])];
    expect(await invoke(command, input, argv)).toEqual({ stdout: command === "csvcut" ? "label\nChangedGamma\nChangedDelta\n" : mode === 5 ? "label,n\nChangedGamma,\nChangedDelta,\n" : "label,n\nChangedGamma,12.0\nChangedDelta,14.0\n", stderr: "", status: 0 });
  });
}
