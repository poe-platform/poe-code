import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, SsconvertError, type CapabilityContext, type Diagnostic, type Engine, type OperationResult, type Workbook } from "../index.js";
import { exportOptionPairs } from "./export-options.js";
import { mergeWorkbookSheets } from "../workbook/merge.js";

const encode = (value: string) => new TextEncoder().encode(value);
const result = (diagnostics: readonly Diagnostic[] = [], exitCode = 0): OperationResult => ({
  diagnostics, exitCode, artifacts: [], usage: { inputBytes: 0, outputBytes: 0 }, profile: "gnumeric-1.12.61"
});

describe("independent export option and failure-stage stress", () => {
  it("retains vertical tab in values because GLib does not classify it as space", () => {
    expect([...exportOptionPairs("sheet=Original\u000b")]).toEqual([["sheet", "Original\u000b"]]);
  });
  it("reports a leading vertical tab as syntax rather than accepting the next key", () => {
    expect(() => [...exportOptionPairs("\u000bsheet=Original")]).toThrow("ssconvert: Syntax error");
  });
  it("keeps vertical tab in the CLI sheet diagnostic without publishing output", async () => {
    const f = fixture();
    expect(await runCommand([...argv, "-O", "sheet=Original\u000b"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe('ssconvert: Unknown sheet "Original\u000b"\n');
    expect(f.stdout).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
  it("does not discard a byte-order mark from an unquoted option value", () => {
    // go_parse_key_value uses g_unichar_isspace; U+FEFF is category Cf, not whitespace.
    expect([...exportOptionPairs("sheet=Original\ufeff")]).toEqual([["sheet", "Original\ufeff"]]);
  });
  it("does not silently consume a leading byte-order mark before an option key", () => {
    expect(() => [...exportOptionPairs("\ufeffsheet=Original")]).toThrow("ssconvert: Syntax error");
  });
  it("unescapes quote/backslash literally and permits adjacent quoted pairs", () => {
    expect([...exportOptionPairs("'she\\et'='Orig\\inal'\"active-sheet\"=\"\"")]).toEqual([
      ["sheet", "Original"], ["active-sheet", ""]
    ]);
  });
  it.each([
    ["sheet", "ssconvert: Syntax error"],
    ["sheet='unterminated", "ssconvert: Quoted string not terminated"],
    ["sheet='trailing\\", "ssconvert: Quoted string not terminated"]
  ])("reports the original grammar error for %s", (text, message) => {
    expect(() => [...exportOptionPairs(text)]).toThrow(message);
  });
  it("rejects unknown sheet before examining malformed later options", async () => {
    const f = fixture();
    expect(await runCommand([...argv, "-O", "sheet=Absent trailing"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe('ssconvert: Unknown sheet "Absent"\n');
    expect(f.stdout).toEqual([]);
  });
  it("matches SDK and CLI option diagnostics without touching output", async () => {
    const f = fixture();
    const request = { input: { kind: "resource" as const, uri: "/input.fixture" },
      destination: { kind: "stream" as const, sink: f.operation.stdout }, exportType: "original:fixture", exportOptions: ["bad=1"] };
    await expect(f.engine.convert(request, f.operation)).rejects.toMatchObject({
      exitCode: 1, message: 'ssconvert: Invalid export option "bad" for format original:fixture'
    });
    expect(await runCommand([...argv, "-O", "bad=1"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe('ssconvert: Invalid export option "bad" for format original:fixture\n');
    expect(f.stdout).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
  it("lets invalid updates precede malformed export options and invalid range", async () => {
    const f = fixture();
    expect(await runCommand([...argv, "--set", "invalid=1", "-O", "trailing", "--export-range", "invalid"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe("Failed to set cell invalid=1\n");
  });
  it("lets export option failure precede invalid export range", async () => {
    const f = fixture();
    expect(await runCommand([...argv, "-O", "trailing", "--export-range", "invalid"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe("ssconvert: Syntax error\n");
  });
  it.each(["--list-importers", "--unknown-original-option"])("never retries typed stderr failures for %s", async argument => {
    const f = fixture();
    const failure = new SsconvertError("io", "stderr failed", 13);
    let calls = 0;
    const operation = { ...f.operation, stderr: { async write() { calls++; throw failure; } } };
    await expect(runCommand([argument], f.engine, operation)).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(f.stdout).toEqual([]);
  });
  it("never retries a typed stderr failure during streamed diagnostics", async () => {
    const f = fixture();
    const failure = new SsconvertError("io", "stderr failed", 13);
    let calls = 0;
    const engine: Engine = { ...f.engine, async convert(_request, operation) {
      await operation.diagnostic?.({ code: "original", severity: "warning", message: "original" });
      return result();
    } };
    const operation = { ...f.operation, stderr: { async write() { calls++; throw failure; } } };
    await expect(runCommand(argv, engine, operation)).rejects.toBe(failure);
    expect(calls).toBe(1);
  });
});

describe("independent source-grounded plain-sheet merge", () => {
  const limits = { inputBytes: 100, outputBytes: 1000, cells: 100, sheets: 10, operations: 10 };
  const book = (name: string, id = "original", rows = 65536, columns = 256): Workbook => ({
    sheets: [{ id, name, size: { rows, columns }, cells: [] }]
  });
  it.each([
    ["Sheet1", "Sheet1(2)"],
    ["Sheet1(8)", "Sheet1(9)"],
    ["Sheet1()", "Sheet1(1)"],
    ["Sheet1(4294967295)", "Sheet1(0)"],
    ["Sheet1(4294967296)", "Sheet1(4294967296)(2)"]
  ])("matches native strip-number/default/unsigned increment for %s", (name, expected) => {
    const target = book(name);
    const incoming = book(name);
    const merged = mergeWorkbookSheets(target, incoming, limits);
    expect(merged.sheets.map(sheet => sheet.name)).toEqual([name, expected]);
    expect(target.sheets[0]!.name).toBe(name);
    expect(incoming.sheets[0]!.name).toBe(name);
    expect(new Set(merged.sheets.map(sheet => sheet.id)).size).toBe(2);
  });
  it("retains native minimum suggested default dimensions for smaller input sheets", () => {
    const merged = mergeWorkbookSheets(book("first", "first", 128, 128), book("second", "second", 256, 128), limits);
    expect(merged.sheets.map(sheet => sheet.size)).toEqual([
      { rows: 65536, columns: 256 }, { rows: 65536, columns: 256 }
    ]);
  });
  it("skips colliding names case-insensitively and preserves sheet order", () => {
    const target: Workbook = { sheets: [...book("Sheet1").sheets, ...book("sHEET1(2)", "other").sheets] };
    const merged = mergeWorkbookSheets(target, book("SHEET1"), limits);
    expect(merged.sheets.map(sheet => sheet.name)).toEqual(["Sheet1", "sHEET1(2)", "SHEET1(3)"]);
  });
  it("rejects aggregate sheet/cell storage overflow before modifying inputs", () => {
    const target = book("first"), incoming = book("second");
    expect(() => mergeWorkbookSheets(target, incoming, { ...limits, sheets: 1 })).toThrow("ssconvert workbook storage limit exceeded");
    const populated: Workbook = { sheets: [{ id: "populated", name: "populated", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }] }] };
    expect(() => mergeWorkbookSheets(populated, populated, { ...limits, cells: 1 })).toThrow("ssconvert workbook storage limit exceeded");
    expect(target.sheets).toHaveLength(1);
    expect(incoming.sheets).toHaveLength(1);
  });
  it("preserves formula-bearing sheets after local reference merge support", () => {
    const incoming: Workbook = { sheets: [{ id: "formula", name: "formula", cells: [{ row: 0, column: 0, value: { kind: "blank" }, formula: "=A2" }] }] };
    expect(mergeWorkbookSheets(book("first"), incoming, limits).sheets[1]!.cells).toEqual(incoming.sheets[0]!.cells);
  });
  it("cancels on first unconditional merge notice without publishing or changing namespace", async () => {
    const f = fixture();
    f.volume.writeFileSync("/second.fixture", "original");
    const reason = new Error("original merge cancellation");
    const operation = { ...f.operation, stderr: { async write(bytes: Uint8Array) {
      f.stderr.push(new Uint8Array(bytes));
      f.controller.abort(reason);
    } } };
    await expect(runCommand(["-M", "/out.fixture", "/input.fixture", "/second.fixture"], f.engine, operation)).rejects.toBe(reason);
    expect(f.errors()).toBe("Adding sheets from file:///input.fixture\n");
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original", "/second.fixture": "original" });
  });
  it("bounds combined merge input bytes before announcing any sheets or publishing output", async () => {
    const f = fixture();
    f.volume.writeFileSync("/input.fixture", "a".repeat(60));
    f.volume.writeFileSync("/second.fixture", "b".repeat(60));
    expect(await runCommand(["-M", "/out.fixture", "/input.fixture", "/second.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe("ssconvert input bytes limit exceeded\n");
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "a".repeat(60), "/second.fixture": "b".repeat(60) });
  });
});
function fixture(payload = encode('"original,value",2\n'), emit?: (context: CapabilityContext) => Promise<void>, outputBytes = 1000,
  readBook?: (context: CapabilityContext) => Promise<Workbook>, observe?: (book: Workbook) => void) {
  const volume = Volume.fromJSON({ "/input.fixture": "original" });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const controller = new AbortController();
  const engine = createEngine({
    codecs: [{
      id: "original:fixture", description: "Original fixture", extensions: ["fixture"],
      probeContent: () => true,
      async read(_bytes, context) { await emit?.(context); return readBook ? readBook(context) : { sheets: [{ id: "s", name: "Original", cells: [] }] }; },
      async write(book) { observe?.(book); return new Uint8Array(payload); }
    }],
    limits: { inputBytes: 100, outputBytes, cells: 100, sheets: 10, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    }
  });
  const operation = {
    signal: controller.signal,
    stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } }
  };
  return { engine, operation, controller, volume, stdout, stderr,
    errors: () => stderr.map(bytes => new TextDecoder().decode(bytes)).join("") };
}
const argv = ["-T", "original:fixture", "/input.fixture", "fd://1"];

describe("independent merge admission and ownership stress", () => {
  it("admits aggregate decoded sheet storage before a third decoder or any notices", async () => {
    let reads = 0;
    const source: Workbook = { sheets: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, name: `Original${index}`, cells: [] })) };
    const original = JSON.stringify(source);
    const f = fixture(encode("output"), undefined, 1000, async () => { reads++; return source; });
    f.volume.writeFileSync("/second.fixture", "second");
    f.volume.writeFileSync("/third.fixture", "third");
    expect(await runCommand(["-M", "/out.fixture", "/input.fixture", "/second.fixture", "/third.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(reads).toBe(2);
    expect(f.errors()).toBe("ssconvert workbook storage limit exceeded\n");
    expect(JSON.stringify(source)).toBe(original);
    expect(f.volume.existsSync("/out.fixture")).toBe(false);
  });
  it("owns each decoded input before another decoder mutates caller source records", async () => {
    const first = { sheets: [{ id: "first", name: "First", cells: [] }] };
    let reads = 0;
    const observed: string[][] = [];
    const f = fixture(encode("output"), undefined, 1000, async () => {
      if (++reads === 1) return first;
      first.sheets[0]!.name = "Mutated caller record";
      return { sheets: [{ id: "second", name: "Second", cells: [] }] };
    }, book => { observed.push(book.sheets.map(sheet => sheet.name)); });
    f.volume.writeFileSync("/second.fixture", "second");
    expect(await runCommand(["-M", "/out.fixture", "/input.fixture", "/second.fixture"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(observed).toEqual([["First", "Second"]]);
    expect(first.sheets[0]!.name).toBe("Mutated caller record");
  });
  it("preserves SDK cancellation before validating a decoder result", async () => {
    const reason = new Error("decoder cancellation");
    const f = fixture(encode("output"), undefined, 1000, async () => {
      f.controller.abort(reason);
      return { sheets: [{ id: "same", name: "First", cells: [] }, { id: "same", name: "Second", cells: [] }] };
    });
    await expect(f.engine.merge({ inputs: [{ kind: "resource", uri: "/input.fixture" }, { kind: "resource", uri: "/input.fixture" }],
      destination: { kind: "resource", uri: "/out.fixture" }, exportType: "original:fixture" }, f.operation)).rejects.toBe(reason);
    expect(f.stderr).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
});

describe("independent virtual cwd and resource error stress", () => {
  function ioFixture(failure: unknown, cwd = "/work") {
    const f = fixture();
    const reads: string[] = [];
    let writes = 0;
    const engine = createEngine({
      codecs: [{ id: "original:fixture", description: "Original I/O fixture", extensions: ["fixture"], async write() { return encode("output"); } }],
      limits: { inputBytes: 100, outputBytes: 1000, cells: 100, sheets: 10, operations: 10 },
      environment: { env: { PWD: cwd }, locale: "C", timezone: "UTC" },
      filesystem: {
        async read(uri) { reads.push(uri); throw failure; },
        async write() { writes++; throw new Error("unexpected publication"); }
      }
    });
    return { ...f, engine, reads, writes: () => writes };
  }
  it.each([
    ["missing.fixture", "/work/missing.fixture"],
    ["../missing file.fixture", "/missing file.fixture"],
    ["/absolute.fixture", "/absolute.fixture"],
    ["file:///virtual%20file.fixture", "/virtual file.fixture"],
    ["file:///invalid%GG.fixture", "file:///invalid%GG.fixture"],
    ["https://original.invalid/missing.fixture", "https://original.invalid/missing.fixture"]
  ])("formats the virtual identity for %s without changing the capability resource", async (uri, display) => {
    const f = ioFixture(Object.assign(new Error("original errno"), { code: "ENOENT" }));
    expect(await runCommand(["-T", "original:fixture", uri, "fd://1"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe(`E ${display}: No such file or directory\n`);
    expect(f.reads).toEqual([uri]);
    expect(f.writes()).toBe(0);
    expect(f.stdout).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
  it("preserves opaque failure identity even for malformed explicit file URI", async () => {
    const failure = new Error("original opaque failure");
    const f = ioFixture(failure);
    await expect(runCommand(["-T", "original:fixture", "file:///invalid%GG.fixture", "fd://1"], f.engine, f.operation)).rejects.toBe(failure);
    expect(f.stderr).toEqual([]);
    expect(f.stdout).toEqual([]);
    expect(f.reads).toEqual(["file:///invalid%GG.fixture"]);
    expect(f.writes()).toBe(0);
  });
});

describe("independent diagnostic and byte-channel stress", () => {
  it("copies codec-owned bytes before callback and result retention", async () => {
    const bytes = new Uint8Array([255, 10]);
    const f = fixture(encode("output"), async context => {
      await context.diagnostic?.({ code: "owned", severity: "warning", message: "owned", bytes });
      bytes.fill(0);
    });
    const seen: Uint8Array[] = [];
    const converted = await f.engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
      destination: { kind: "stream", sink: f.operation.stdout }, exportType: "original:fixture" },
    { ...f.operation, async diagnostic(diagnostic) { seen.push(new Uint8Array(diagnostic.bytes!)); } });
    expect(seen).toEqual([new Uint8Array([255, 10])]);
    expect(converted.diagnostics[0]!.bytes).toEqual(new Uint8Array([255, 10]));
    expect(converted.diagnostics[0]!.bytes).not.toBe(bytes);
  });
  it("bounds cumulative diagnostic bytes before delivering an overflowing warning", async () => {
    const f = fixture(encode("output"), async context => {
      for (let index = 0; index < 3; index++) await context.diagnostic?.({
        code: "owned", severity: "warning", message: "a", bytes: new Uint8Array(400)
      });
    });
    expect(await runCommand(argv, f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.stderr.slice(0, 2)).toEqual([new Uint8Array(400), new Uint8Array(400)]);
    expect(f.stderr[2]).toEqual(encode("ssconvert diagnostic bytes limit exceeded\n"));
    expect(f.stdout).toEqual([]);
  });
  it("counts UTF-8 message bytes and newline against the exact diagnostic budget", async () => {
    const f = fixture(encode("output"), async context => {
      await context.diagnostic?.({ code: "owned", severity: "warning", message: "é😀" });
    }, 6);
    expect(await runCommand(argv, f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe("ssconvert diagnostic bytes limit exceeded\n");
    expect(f.stdout).toEqual([]);
  });
  it.each([encode('"original,value",2\n'), new Uint8Array([0, 255, 128, 13, 10])])(
    "keeps fd://1 data exact alongside warning callbacks", async payload => {
      const f = fixture(payload);
      const warning: Diagnostic = { code: "original-warning", severity: "warning", message: "original warning" };
      const engine: Engine = { ...f.engine, async convert(request, operation) {
        await operation.diagnostic?.(warning);
        const converted = await f.engine.convert(request, operation);
        return { ...converted, diagnostics: [warning] };
      } };
      expect(await runCommand(argv, engine, f.operation)).toMatchObject({ exitCode: 0 });
      expect(f.stdout).toEqual([payload]);
      expect(f.errors()).toBe("original warning\n");
      expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
    }
  );
  it("preserves raw callback diagnostic bytes before typed failure status", async () => {
    const f = fixture();
    const engine: Engine = { ...f.engine, async convert(_request, operation) {
      await operation.diagnostic?.({ code: "original", severity: "warning", message: "unused", bytes: new Uint8Array([255, 10]) });
      throw new SsconvertError("io", "original failure", 9);
    } };
    expect(await runCommand(argv, engine, f.operation)).toEqual({ exitCode: 9 });
    expect(f.stderr).toEqual([new Uint8Array([255, 10]), encode("original failure\n")]);
    expect(f.stdout).toEqual([]);
  });
  it("does not conflate different warnings with equal messages", async () => {
    const f = fixture();
    const warning: Diagnostic = { code: "original", severity: "warning", message: "same" };
    const engine: Engine = { ...f.engine, async convert(_request, operation) {
      await operation.diagnostic?.(warning);
      return result([warning, { ...warning }], 6);
    } };
    expect(await runCommand(argv, engine, f.operation)).toMatchObject({ exitCode: 6 });
    expect(f.errors()).toBe("same\nsame\n");
  });
  it("propagates plain simulated sink failure without inventing status", async () => {
    const f = fixture();
    const failure = new Error("original sink failure");
    const operation = { ...f.operation, stdout: { async write() { throw failure; } } };
    await expect(runCommand(argv, f.engine, operation)).rejects.toBe(failure);
    expect(f.stderr).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
  it("retains cancellation reason when stdout aborts during its write", async () => {
    const f = fixture();
    const reason = new Error("original cancellation");
    const operation = { ...f.operation, stdout: { async write(bytes: Uint8Array) {
      f.stdout.push(new Uint8Array(bytes));
      f.controller.abort(reason);
    } } };
    await expect(runCommand(argv, f.engine, operation)).rejects.toBe(reason);
    expect(f.stderr).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
  it("stops diagnostic result delivery immediately after cancellation", async () => {
    const f = fixture();
    const reason = new Error("diagnostic cancellation");
    const engine: Engine = { ...f.engine, async convert() { return result([
      { code: "first", severity: "warning", message: "first" },
      { code: "second", severity: "warning", message: "second" }
    ]); } };
    const operation = { ...f.operation, stderr: { async write(bytes: Uint8Array) {
      f.stderr.push(new Uint8Array(bytes));
      f.controller.abort(reason);
    } } };
    await expect(runCommand(argv, engine, operation)).rejects.toBe(reason);
    expect(f.errors()).toBe("first\n");
  });
  it("uses native UTF-8 prefix ordering and byte width independent of registration order", async () => {
    const f = fixture();
    const services = ["éé", "aa", "a", "z", "é"].map(id => ({ id, description: id, extensions: [] }));
    const engine: Engine = { ...f.engine, listServices: () => services };
    await runCommand(["--list-importers"], engine, f.operation, { listingEncoding: "utf8" });
    expect(f.errors()).toBe("ID   | Description\na    | a\naa   | aa\nz    | z\né   | é\néé | éé\n");
    expect(services.map(service => service.id)).toEqual(["éé", "aa", "a", "z", "é"]);
    expect(f.stdout).toEqual([]);
  });
  it("does not allow hidden descriptors to widen an otherwise empty listing", async () => {
    const f = fixture();
    const engine: Engine = { ...f.engine, listServices: () => [{
      id: "original-hidden-long-name", description: "hidden", extensions: [], interactiveOnly: true
    }] };
    expect(await runCommand(["--list-exporters"], engine, f.operation)).toEqual({ exitCode: 0 });
    expect(f.errors()).toBe("ID | Description\n");
  });
  it("reports unknown exporter before missing importer and input access", async () => {
    const f = fixture();
    expect(await runCommand(["-I", "unknown-importer", "-T", "unknown-exporter", "/missing", "/output.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe("Unknown exporter 'unknown-exporter'.\nTry --list-exporters to see a list of possibilities.\n");
    expect(f.volume.toJSON()).toEqual({ "/input.fixture": "original" });
  });
});
