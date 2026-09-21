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

it("plain CSV accepts common selection and rejects configurable text options", async () => {
  const f = fixture("Gnumeric_stf:stf_csv");
  try {
    expect(await runCommand(["-T", "Gnumeric_stf:stf_csv", "-O", "sheet=Last", "/in", "/out"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(f.saved()?.[3]).toEqual({ sheets: ["b"] });
    expect(await runCommand(["-T", "Gnumeric_stf:stf_csv", "-O", "separator=;", "/in", "/out"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors).toEqual(['ssconvert: Invalid export option "separator" for format Gnumeric_stf:stf_csv\n']);
  } finally { await f.engine.dispose(); }
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
