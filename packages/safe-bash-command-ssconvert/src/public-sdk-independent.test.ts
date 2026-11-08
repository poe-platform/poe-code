import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createXlsxWriter, exportOptionPairs, probeXlsx, readXlsx, runCommand,
  type CapabilityContext, type Codec, type EngineConfig, type Workbook } from "./index.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10, sheets: 2, operations: 20 } };
const book: Workbook = { sheets: [{ id: "s", name: "Independent", cells: [
  { row: 2, column: 1, value: { kind: "string", value: "λ & <portable>" } },
  { row: 0, column: 0, value: { kind: "boolean", value: false } }
] }] };

it.each(["2006", "2008"] as const)("public %s codecs enforce independent structural budgets and preserve caller data", async edition => {
  const original = structuredClone(book);
  const bytes = await createXlsxWriter(edition)(book, [], context);
  expect(await probeXlsx(bytes, context)).toBe(true);
  expect(await probeXlsx(new Uint8Array([1, 2, 3]), context)).toBe(false);
  for (const limits of [{ cells: 1 }, { sheets: 0 }, { workbookNodes: 1 }, { workbookTextBytes: 1 }, { workbookWork: 0 }]) {
    const bounded = { ...context, limits: { ...context.limits, ...limits } };
    await expect(readXlsx(bytes, bounded)).rejects.toMatchObject({ code: "resource-limit" });
  }
  for (const limits of [{ cells: 1 }, { sheets: 0 }, { outputBytes: 1 }, { workbookWork: 0 }]) {
    await expect(createXlsxWriter(edition)(book, [], { ...context, limits: { ...context.limits, ...limits } }))
      .rejects.toMatchObject({ code: "resource-limit" });
  }
  const reopened = await readXlsx(bytes, context);
  const mutable = reopened.sheets[0]!.cells[0]! as { value: import("./index.js").CellValue };
  mutable.value = { kind: "string", value: "consumer mutation" };
  expect(book).toEqual(original);
  expect((await readXlsx(bytes, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "boolean", value: false });
});

it("public writer observes cancellation raised by an awaited diagnostic and preserves falsey reason identity", async () => {
  const controller = new AbortController();
  const diagnostics: string[] = [];
  const retained: Workbook = { ...book, unsupportedRecords: [{ source: "independent", kind: "opaque", disposition: "retained", data: {} }] };
  await expect(createXlsxWriter("2008")(retained, [], { ...context, signal: controller.signal,
    async diagnostic(item) { diagnostics.push(item.code); controller.abort(0); } })).rejects.toBe(0);
  expect(diagnostics).toEqual(["xlsx-write-loss"]);
});

it("public command and conversion engine preserve repeated exporter options and identical namespace effects", async () => {
  const volume = Volume.fromJSON({ "/input.original": "payload" });
  const calls: string[][] = [];
  const codec: Codec = { id: "independent", description: "Original fixture", extensions: ["original"], probeContent: () => true,
    async read(bytes) { return { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
      value: { kind: "string", value: new TextDecoder().decode(bytes) } }] }] }; },
    async exportOptions(options) { return [...options]; },
    async write(_book, options) { calls.push([...options]); return new TextEncoder().encode("converted"); } };
  const config: EngineConfig = { codecs: [codec], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } };
  const engine = createEngine(config), output: Uint8Array[] = [], errors: Uint8Array[] = [];
  try {
    const optionText = "mode=first mode=second label='two words'", options = [optionText];
    const sdk = await engine.convert({ input: { kind: "resource", uri: "/input.original" },
      destination: { kind: "resource", uri: "/sdk.original" }, exportType: "independent", exportOptions: options }, { signal: context.signal });
    const cli = await runCommand(["-T", "independent", "-O", "ignored=earlier", "-O", optionText, "/input.original", "/cli.original"],
      engine, { signal: context.signal, stdout: { async write(bytes) { output.push(bytes.slice()); } },
        stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
    expect(sdk.exitCode).toBe(0);
    expect(cli.exitCode).toBe(sdk.exitCode);
    expect(calls).toEqual([options, options]);
    expect(volume.readFileSync("/cli.original")).toEqual(volume.readFileSync("/sdk.original"));
    expect(volume.readdirSync("/")).toEqual(["cli.original", "input.original", "sdk.original"]);
    expect(output).toEqual([]);
    expect(errors).toEqual([]);
    expect([...exportOptionPairs(optionText)]).toEqual([["mode", "first"], ["mode", "second"], ["label", "two words"]]);
  } finally { await engine.dispose(); }
});
