import { describe, it, expect } from "vitest";
import { Volume } from "memfs";
import { solverRecord, constraintRecord } from "./codecs/mps.js";
import { createEngine, createResourceIO, runCommand, type EngineConfig, type Codec } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function fixture() {
  const volume = Volume.fromJSON({ "/input.fixture": "original" });
  const events: string[] = [];
  const codec: Codec = {
    id: "fixture",
    description: "Original in-memory contract fixture",
    extensions: ["fixture"],
    async exportOptions(options) { return [...options]; },
    probeContent: () => true,
    async read(bytes) {
      return {
        sheets: [
          {
            id: "s1",
            name: "Sheet1",
            cells: [{ row: 0, column: 0, value: { kind: "string", value: decode(bytes) } }]
          }
        ]
      };
    },
    async write(book, options) {
      events.push(...options);
      return encode(
        String(
          book.sheets[0]!.cells[0]!.value.kind === "string"
            ? book.sheets[0]!.cells[0]!.value.value
            : ""
        )
      );
    }
  };
  const config: EngineConfig = {
    codecs: [codec],
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri, signal) {
        signal.throwIfAborted();
        return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
      },
      async write(uri, bytes, signal) {
        signal.throwIfAborted();
        volume.writeFileSync(uri, bytes);
      }
    }
  };
  return { config, volume, events };
}
describe("shared ssconvert engine contracts", () => {
  it("preserves explicit stdin origin through the command and SDK capability context", async () => {
    for (const origin of [undefined, true, false]) {
      const { config } = fixture();
      const observed: unknown[] = [];
      const engine = createEngine({ ...config, codecs: [{ ...config.codecs[0]!,
        async read(bytes, context) {
          observed.push("stdinIsDefault" in context ? context.stdinIsDefault : undefined);
          return config.codecs[0]!.read!(bytes, context);
        }
      }] });
      const operation = { signal: new AbortController().signal,
        ...(origin === undefined ? {} : { stdinIsDefault: origin }),
        stdout: { async write() {} }, stderr: { async write() {} } };
      try {
        expect((await runCommand(["/input.fixture", "/command.fixture"], engine, operation)).exitCode).toBe(0);
        expect((await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
          destination: { kind: "resource", uri: "/sdk.fixture" } }, operation)).exitCode).toBe(0);
        expect(observed).toEqual([origin, origin]);
      } finally { await engine.dispose(); }
    }
  });
  it("uses native descriptor basename for unsupported empty stream input", async () => {
    const { config } = fixture();
    const engine = createEngine({ ...config, codecs: [{ ...config.codecs[0]!, probeContent: () => false }] });
    await expect(engine.readWorkbook({ kind: "stream", source: [], filename: "fd://0" }, {},
      { signal: new AbortController().signal })).rejects.toThrow('E Unsupported file format for file "."');
    await engine.dispose();
  });
  it("infers a single-input destination only from an explicit exporter", async () => {
    const { config, volume } = fixture();
    const engine = createEngine({ ...config, filesystem: createResourceIO({ cwd: "/", filesystem: config.filesystem! }) });
    const errors: string[] = [];
    const operation = {
      signal: new AbortController().signal,
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(decode(bytes)); } }
    };
    expect(await runCommand(["/input.fixture"], engine, operation)).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["An output file name or an explicit export type is required.\nTry --list-exporters to see a list of possibilities.\n"]);
    expect(await runCommand(["-T", "fixture", "/input.fixture"], engine, operation)).toEqual({
      exitCode: 0, diagnostics: [], artifacts: [{ bytes: 8, uri: "file:///input.fixture" }],
      profile: "gnumeric-1.12.61", usage: { inputBytes: 8, outputBytes: 8 }
    });
    expect(volume.readFileSync("/input.fixture", "utf8")).toBe("original");
    errors.length = 0;
    expect(await runCommand(["-T", "missing", "/input.fixture"], engine, operation)).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["Unknown exporter 'missing'.\nTry --list-exporters to see a list of possibilities.\n"]);
  });
  it("never resolves an invalid byte filename through its replacement display text", async () => {
    const { config, volume } = fixture();
    volume.writeFileSync("/\ufffd.fixture", "keep");
    const reads: string[] = [];
    const engine = createEngine({ ...config, filesystem: {
      async read(uri, signal) { reads.push(uri); return config.filesystem!.read(uri, signal); },
      write: config.filesystem!.write
    } });
    const errors: string[] = [];
    const result = await runCommand([
      new Uint8Array([47, 255, ...encode(".fixture")]), "/output.fixture"
    ], engine, {
      signal: new AbortController().signal, stdout: { async write() {} },
      stderr: { async write(bytes) { errors.push(decode(bytes)); } }
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["Unsupported ssconvert feature: non-UTF-8 resource name\n"]);
    expect(reads).toEqual([]);
    expect(volume.toJSON()).toEqual({ "/input.fixture": "original", "/\ufffd.fixture": "keep" });
  });
  it("dispatches goal seek, solver, analysis and recalculation in source order", async () => {
    const { config } = fixture();
    const order: string[] = [];
    const engine = createEngine({
      ...config,
      formulas: {
        async recalculate(book) {
          order.push("recalc");
          return book;
        }
      },
      solver: {
        async goalSeek(book) {
          order.push("goal");
          return book;
        },
        async solve(book) {
          order.push("solve");
          return book;
        }
      },
      analysis: {
        async analyze(book) {
          order.push("analysis");
          return book;
        }
      }
    });
    const range = { sheet: "s1", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    await engine.convert(
      {
        input: { kind: "resource", uri: "/input.fixture" },
        destination: { kind: "resource", uri: "/ordered.fixture" },
        goalSeek: [{ target: range, variable: range, value: 1 }],
        solve: true,
        analysis: { tool: "fixture", properties: [] },
        recalc: true
      },
      { signal: new AbortController().signal }
    );
    expect(order).toEqual(["recalc", "goal", "solve", "analysis", "recalc", "recalc"]);
  });
  it("requires every runtime budget even at an untyped SDK boundary", () => {
    const { config } = fixture();
    const incomplete: { -readonly [Key in keyof EngineConfig["limits"]]?: number } = {
      ...config.limits
    };
    delete incomplete.inputBytes;
    expect(() => createEngine({ ...config, limits: incomplete as EngineConfig["limits"] })).toThrow(
      "Invalid ssconvert limit: inputBytes"
    );
  });
  it("CLI and SDK use the same writer; SDK options repeat, CLI scalar last wins", async () => {
    const { config, volume, events } = fixture();
    const engine = createEngine(config);
    const signal = new AbortController().signal;
    await engine.convert(
      {
        input: { kind: "resource", uri: "/input.fixture" },
        destination: { kind: "resource", uri: "/sdk.fixture" },
        exportOptions: ["first", "second"],
        updates: [
          { sheet: "s1", row: 0, column: 0, value: { kind: "string", value: "first" } },
          { sheet: "s1", row: 0, column: 0, value: { kind: "string", value: "last" } }
        ]
      },
      { signal }
    );
    expect(volume.readFileSync("/sdk.fixture", "utf8")).toBe("last");
    const result = await runCommand(
      ["-O", "cli-first", "-O", "cli-last", "/input.fixture", "/cli.fixture"],
      engine,
      { signal, stdout: { async write() {} }, stderr: { async write() {} } }
    );
    expect(result.exitCode).toBe(0);
    expect(events).toEqual(["first", "second", "cli-last"]);
    expect(volume.readFileSync("/cli.fixture", "utf8")).toBe("original");
  });
  it("solves validated models before exporting through injected memfs I/O", async () => {
    const { config, volume } = fixture();
    const codec: Codec = { ...config.codecs[0]!, async read() { return { sheets: [{ id: "s1", name: "Sheet1", cells: [
      { row: 0, column: 0, value: { kind: "number", value: 2 } },
      { row: 0, column: 1, formula: "=A1*2", value: { kind: "number", value: 4 } }
    ], unsupportedRecords: [{ source: "gnumeric", kind: "Solver", disposition: "retained", data: solverRecord({ Target: "B1", Inputs: "A1" }, [constraintRecord(2, "B1", "0")]) }] }] }; } };
    const result = await createEngine({ ...config, codecs: [codec] }).convert(
        {
          input: { kind: "resource", uri: "/input.fixture" },
          destination: { kind: "resource", uri: "/no.fixture" },
          solve: true
        },
        { signal: new AbortController().signal }
    );
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(volume.existsSync("/no.fixture")).toBe(true);
  });
  it("copies producer chunks before advancing and refuses output over budget", async () => {
    const { config, volume } = fixture();
    const source = (async function* () {
      const bytes = encode("a");
      yield bytes;
      bytes[0] = 98;
      yield bytes;
    })();
    await createEngine(config).convert(
      {
        input: { kind: "stream", source, filename: "a.fixture" },
        destination: { kind: "resource", uri: "/copy.fixture" }
      },
      { signal: new AbortController().signal }
    );
    expect(volume.readFileSync("/copy.fixture", "utf8")).toBe("ab");
    await expect(
      createEngine({ ...config, limits: { ...config.limits, outputBytes: 1 } }).convert(
        {
          input: { kind: "resource", uri: "/input.fixture" },
          destination: { kind: "resource", uri: "/large.fixture" }
        },
        { signal: new AbortController().signal }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(volume.existsSync("/large.fixture")).toBe(false);
  });
});
