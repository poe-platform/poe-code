import { expect, it } from "vitest";
import { createEngine } from "./engine.js";
import type { EngineConfig } from "./contracts.js";

const encode = (text: string) => new TextEncoder().encode(text);
// Original native-qualified linear model, with a datasource cell and its dependent.
const input = encode('<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>S</Name><Solver Target="$C$1" Inputs="$A$1:$B$1" ModelType="0" ProblemType="0" NonNeg="1" MaxTime="5" MaxIter="100"><Constr Type="2" lhs="A1" rhs="1"/><Constr Type="2" lhs="B1" rhs="2"/></Solver><Cells><Cell Row="0" Col="0" ValueType="40">0</Cell><Cell Row="0" Col="1" ValueType="40">0</Cell><Cell Row="0" Col="2">=A1+B1</Cell><Cell Row="0" Col="3">=ATL_LAST("stock")</Cell><Cell Row="0" Col="4">=D1+1</Cell></Cells></Sheet></Sheets></Workbook>');
const config = { codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 5000, outputBytes: 5000, cells: 100, sheets: 2, operations: 1000, workbookWork: 100000 } };
async function convert(engine: ReturnType<typeof createEngine>, solve = true, signal = new AbortController().signal, sourceInput = input) {
  const chunks: Uint8Array[] = [];
  const result = await engine.convert({ input: { kind: "stream", filename: "input.gnumeric", source: [sourceInput] },
    solve, recalc: true, exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal });
  return { result, csv: chunks.map(bytes => new TextDecoder().decode(bytes)).join("") };
}
it("replays the actual native stock17/23 feed and dependent24 through an owned session", async () => {
  let opened = 0, polled = 0, closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() {
    opened++;
    return { async poll() { polled++; return [encode("stock:17\nstock:23\n")]; }, async close() { closed++; } };
  } } } as EngineConfig);
  try {
    const result = await convert(engine);
    expect(result.csv).toBe("1,2,3,23,24\n");
    expect(result.result.exitCode).toBe(0);
    expect({ opened, polled, closed }).toEqual({ opened: 1, polled: 1, closed: 1 });
  } finally { await engine.dispose(); }
  expect(closed).toBe(1);
});
it("opens and closes an explicit datasource without polling ordinary conversion", async () => {
  let polled = 0, closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() {
    return { async poll() { polled++; return [encode("stock:23\n")]; }, close() { closed++; } };
  } } } as EngineConfig);
  try { expect((await convert(engine, false)).csv).toBe("0,0,0,#N/A,#N/A\n"); }
  finally { await engine.dispose(); }
  expect(polled).toBe(0); expect(closed).toBe(1);
});
it("keeps simultaneous operation sessions and their last values separate", async () => {
  let opened = 0, closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() {
    const value = ++opened === 1 ? 23 : 41;
    return { async poll() { return [encode(`stock:${value}\n`)]; }, close() { closed++; } };
  } } } as EngineConfig);
  try { expect((await Promise.all([convert(engine), convert(engine)])).map(value => value.csv)).toEqual(["1,2,3,23,24\n", "1,2,3,41,42\n"]); }
  finally { await engine.dispose(); }
  expect(closed).toBe(2);
});
it("closes the session when a polled byte batch exceeds its acquisition budget", async () => {
  let closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() {
    return { async poll() { return [new Uint8Array(5001)]; }, close() { closed++; } };
  } } } as EngineConfig);
  try { await expect(convert(engine)).rejects.toMatchObject({ code: "resource-limit" }); }
  finally { await engine.dispose(); }
  expect(closed).toBe(1);
});
it("closes once and publishes nothing when polling aborts with a falsey reason", async () => {
  const controller = new AbortController(); let closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() {
    return { async poll() { controller.abort(false); return [encode("stock:23\n")]; }, close() { closed++; } };
  } } } as EngineConfig);
  try { await expect(convert(engine, true, controller.signal)).rejects.toBe(false); }
  finally { await engine.dispose(); }
  expect(closed).toBe(1);
});

it("recalculates a fed tag and its dependents without evaluating an unrelated clean formula", async () => {
  const { openDatasourceSession } = await import("./datasource.js");
  let unrelated = 0, polls = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const context = { ...config, signal: new AbortController().signal, own(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    runtimeFunctions: { COUNTED: { signature: "", implementation() { unrelated++; return { kind: "number" as const, value: 7 }; } } } };
  const session = await openDatasourceSession({ async open() { return {
    async poll() { return [encode(`stock:${++polls === 1 ? 17 : 23}\n`)]; }, close() {}
  }; } }, context);
  try {
    const first = await session.poll({ sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, formula: '=ATL_LAST("stock")', value: { kind: "blank" } },
      { row: 0, column: 1, formula: "=A1+1", value: { kind: "blank" } },
      { row: 0, column: 2, formula: "=COUNTED()", value: { kind: "blank" } }
    ] }] });
    const second = await session.poll(first);
    expect(second.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "number", value: 23 }, { kind: "number", value: 24 }, { kind: "number", value: 7 }
    ]);
    expect(unrelated).toBe(1);
  } finally { for (const cleanup of cleanups) await cleanup(); }
});

it("retains partial records and both tag links in one watched formula", async () => {
  const { openDatasourceSession } = await import("./datasource.js");
  let polls = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const context = { ...config, signal: new AbortController().signal, own(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); } };
  const session = await openDatasourceSession({ async open() { return {
    async poll() { return ++polls === 1 ? [encode("one:3\ntwo:"), encode("4\none:5")] : [encode("\n")]; }, close() {}
  }; } }, context);
  try {
    const first = await session.poll({ sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, formula: '=ATL_LAST("one")+ATL_LAST("two")', value: { kind: "blank" } },
      { row: 0, column: 1, formula: "=A1+1", value: { kind: "blank" } }
    ] }] });
    expect(first.sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 7 }, { kind: "number", value: 8 }]);
    const second = await session.poll(first);
    expect(second.sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 9 }, { kind: "number", value: 10 }]);
  } finally { for (const cleanup of cleanups) await cleanup(); }
});
it("keeps an unavailable host session enabled and unfilled", async () => {
  let opened = 0;
  const engine = createEngine({ ...config, datasource: { async open() { opened++; return undefined; } } });
  try { expect((await convert(engine)).csv).toBe("1,2,3,#N/A,#N/A\n"); }
  finally { await engine.dispose(); }
  expect(opened).toBe(1);
});
it("sanitizes a transport failure and closes before the error leaves conversion", async () => {
  let closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() { return {
    async poll() { throw new Error("synthetic private transport detail"); }, close() { closed++; }
  }; } } });
  try { await expect(convert(engine)).rejects.toMatchObject({ code: "io", message: "Could not poll ssconvert datasource" }); }
  finally { await engine.dispose(); }
  expect(closed).toBe(1);
});
it("refuses an ambiguous explicit ATL_LAST registration before acquiring transport", () => {
  let opened = 0;
  expect(() => createEngine({ ...config, datasource: { async open() { opened++; return undefined; } },
    runtimeFunctions: { ATL_LAST: { signature: "s", implementation() { return { kind: "blank" }; } } }
  })).toThrow("Conflicting ssconvert datasource runtime function");
  expect(opened).toBe(0);
});

it("does not poll when solver input-formula admission fails before its event phase", async () => {
  let polled = 0, closed = 0;
  const invalid = encode(new TextDecoder().decode(input).replace('<Cell Row="0" Col="0" ValueType="40">0</Cell>', '<Cell Row="0" Col="0">=1</Cell>'));
  const engine = createEngine({ ...config, datasource: { async open() { return {
    async poll() { polled++; return [encode("stock:23\n")]; }, close() { closed++; }
  }; } } });
  try {
    const result = await convert(engine, true, new AbortController().signal, invalid);
    expect(result.csv).toBe("1,0,1,#N/A,#N/A\n");
    expect(result.result.diagnostics.some(diagnostic => diagnostic.message === "Solver: Input cell A1 contains a formula")).toBe(true);
  } finally { await engine.dispose(); }
  expect(polled).toBe(0); expect(closed).toBe(1);
});

it("closes a transport that arrives after cancellation exactly once", async () => {
  const controller = new AbortController(); let closed = 0;
  const engine = createEngine({ ...config, datasource: { async open() {
    controller.abort(false);
    await Promise.resolve();
    return { async poll() { throw new Error("unexpected poll"); }, close() { closed++; } };
  } } });
  try { await expect(convert(engine, true, controller.signal)).rejects.toBe(false); }
  finally { await engine.dispose(); }
  expect(closed).toBe(1);
});
it("rejects overlapping polls within one session rather than interleaving records", async () => {
  const { openDatasourceSession } = await import("./datasource.js");
  const cleanups: (() => void | Promise<void>)[] = [];
  let entered!: () => void, resolve!: (bytes: Uint8Array[]) => void;
  const polling = new Promise<void>(done => { entered = done; });
  const batch = new Promise<Uint8Array[]>(done => { resolve = done; });
  const context = { ...config, signal: new AbortController().signal, own(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); } };
  const session = await openDatasourceSession({ async open() { return {
    async poll() { entered(); return batch; }, close() {}
  }; } }, context);
  const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula: '=ATL_LAST("stock")', value: { kind: "blank" as const } }] }] };
  try {
    const first = session.poll(book); await polling;
    const second = session.poll(book); resolve([encode("stock:23\n")]);
    const results = await Promise.allSettled([first, second]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "invalid-request", message: "ssconvert datasource poll is already running" } });
  } finally { for (const cleanup of cleanups) await cleanup(); }
});
