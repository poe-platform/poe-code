import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Codec } from "../index.js";

function fixture(id: string) {
  const volume = Volume.fromJSON({ "/in": "original", "/out": "keep" });
  let saved: Parameters<NonNullable<Codec["write"]>> | undefined;
  const engine = createEngine({
    codecs: [{ id: "input", description: "Input", extensions: [], probeContent: () => true,
      async read() { return { activeSheet: "b", sheets: [
        { id: "a", name: "First", cells: [] }, { id: "b", name: "Last", cells: [] }
      ] }; } },
    { id, description: "Output", extensions: [],
      async write(...args) { saved = args; return new TextEncoder().encode("done"); } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, sheets: 2, cells: 10, operations: 20 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } }
  });
  const errors: string[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } } };
  return { engine, operation, volume, errors, saved: () => saved };
}

it.each([
  ["eol=bogus broken", "ssconvert: eol must be one of unix, mac, and windows\n"],
  ["format=bogus", 'ssconvert: Invalid value for option format: "bogus"\n'],
  ["quoting-mode=AUTO", 'ssconvert: Invalid value for option quoting-mode: "AUTO"\n'],
  ["quoting-on-whitespace=maybe", 'ssconvert: Invalid value for option quoting-on-whitespace: "maybe"\n']
])("runs configurable text handlers before subsequent syntax: %s", async (options, error) => {
  const f = fixture("Gnumeric_stf:stf_assistant");
  try {
    expect(await runCommand(["-T", "Gnumeric_stf:stf_assistant", "-O", options, "/in", "/out"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors).toEqual([error]);
    expect(f.saved()).toBeUndefined();
    expect(f.volume.toJSON()).toEqual({ "/in": "original", "/out": "keep" });
  } finally { await f.engine.dispose(); }
});

it("routes text pairs to their handler and common sheet selection in original order", async () => {
  const f = fixture("Gnumeric_stf:stf_assistant");
  const options = "separator='|'sheet=Last sheet=First separator=',' active-sheet=ignored eol=WINDOWS";
  try {
    const result = await f.engine.convert({ input: { kind: "resource", uri: "/in" },
      destination: { kind: "resource", uri: "/out" }, exportType: "Gnumeric_stf:stf_assistant", exportOptions: [options] }, f.operation);
    expect(result.exitCode).toBe(0);
    expect(f.saved()?.[1]).toEqual([options]);
    expect(f.saved()?.[3]).toEqual({ sheets: ["b", "a", "b"] });
  } finally { await f.engine.dispose(); }
});

it("plain CSV accepts common selection and configurable text options", async () => {
  const f = fixture("Gnumeric_stf:stf_csv");
  try {
    expect(await runCommand(["-T", "Gnumeric_stf:stf_csv", "-O", "sheet=Last", "/in", "/out"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(f.saved()?.[3]).toEqual({ sheets: ["b"] });
    expect(await runCommand(["-T", "Gnumeric_stf:stf_csv", "-O", "separator=;", "/in", "/out"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(f.saved()?.[1]).toEqual(["separator=;"]);
    expect(f.errors).toEqual([]);
  } finally { await f.engine.dispose(); }
});

it.each([
  ["format=raw", 0, 'name,value\n"a,b",1.2\n', ""],
  ['"format" = "raw"', 0, 'name,value\n"a,b",1.2\n', ""],
  ["unknown=raw", 1, "keep", 'ssconvert: Invalid export option "unknown" for format Gnumeric_stf:stf_csv\n'],
  ['format="raw"unknown=raw', 1, "keep", 'ssconvert: Invalid export option "unknown" for format Gnumeric_stf:stf_csv\n'],
  ["format=bogus", 1, "keep", 'ssconvert: Invalid value for option format: "bogus"\n'],
  ['format="raw', 1, "keep", "ssconvert: Quoted string not terminated\n"],
  ["broken", 1, "keep", "ssconvert: Syntax error\n"]
])("plain CSV command and SDK preserve exact filesystem effects for %s", async (option, exitCode, output, error) => {
  const input = 'name,value\n"a,b",1.20\n';
  const volume = Volume.fromJSON({ "/input.csv": input, "/output.csv": "keep" });
  const engine = createEngine({ codecs: [],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    }
  });
  const errors: string[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write(bytes: Uint8Array) { expect(bytes.byteLength).toBe(0); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } } };
  try {
    const result = await runCommand(["-T", "Gnumeric_stf:stf_csv", "-O", option, "/input.csv", "/output.csv"], engine, operation);
    expect(result.exitCode).toBe(exitCode);
    expect(errors.join("")).toBe(error);
    expect(volume.toJSON()).toEqual({ "/input.csv": input, "/output.csv": output });
    volume.writeFileSync("/output.csv", "keep");
    const sdk = engine.convert({ input: { kind: "resource", uri: "/input.csv" },
      destination: { kind: "resource", uri: "/output.csv" }, exportType: "Gnumeric_stf:stf_csv",
      exportOptions: [option] }, operation);
    if (exitCode === 0) await expect(sdk).resolves.toMatchObject({ exitCode: 0, diagnostics: [] });
    else await expect(sdk).rejects.toMatchObject({ code: "invalid-request", message: error.trimEnd() });
    expect(volume.toJSON()).toEqual({ "/input.csv": input, "/output.csv": output });
  } finally { await engine.dispose(); }
});

it("uses GOffice Unicode case folding for C-locale boolean names", async () => {
  const f = fixture("Gnumeric_stf:stf_assistant");
  try {
    const result = await f.engine.convert({ input: { kind: "resource", uri: "/in" },
      destination: { kind: "resource", uri: "/out" }, exportType: "Gnumeric_stf:stf_assistant",
      exportOptions: ["quoting-on-whitespace=yeſ"] }, f.operation);
    expect({ result, errors: f.errors }).toMatchObject({ result: { exitCode: 0 }, errors: [] });
    expect(f.errors).toEqual([]);
  } finally { await f.engine.dispose(); }
});
