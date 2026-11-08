import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { snapshotRecords, snapshotWorkbook, updateWorkbook } from "./model.js";
import type { Workbook } from "../workbook.js";

const limits = { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 3, operations: 10 };
const sheet = () => ({ id: "s", name: "s", cells: [] });
function admit(value: unknown) {
  return snapshotWorkbook(value as Workbook, limits);
}

describe("independent bounded workbook stress", () => {
  it("rejects borrowed accessors before any execution or grid preflight", () => {
    let executions = 0;
    const book = Object.defineProperty({}, "sheets", {
      enumerable: true,
      get() {
        executions++;
        return [];
      }
    });
    expect(() => admit(book)).toThrow("accessor");
    expect(executions).toBe(0);
    const borrowedSheet = Object.defineProperty(sheet(), "cells", {
      enumerable: true,
      get() {
        executions++;
        return [];
      }
    });
    expect(() => admit({ sheets: [borrowedSheet] })).toThrow("accessor");
    expect(executions).toBe(0);
  });

  it("rejects sparse arrays, omitted array entries and custom array fields", () => {
    for (const value of [new Array(2), [undefined], Object.assign([], { foreign: 1 })])
      expect(() => snapshotRecords(value, limits)).toThrow("array");
  });

  it.each([
    { dateSystem: "julian" },
    { calculationMode: "sometimes" },
    { iteration: { enabled: "yes", maximum: 1, tolerance: 0 } },
    { iteration: { enabled: true, maximum: 1, tolerance: "zero" } },
    { names: [{ name: "n", expression: 1 }] },
    { names: [{ name: "n", expression: "1", position: { sheet: "missing", row: 0, column: 0 } }] },
    { names: [{ name: "n", expression: "1", position: { sheet: "s", row: -1, column: 0 } }] }
  ])("rejects malformed workbook metadata %#", (metadata) => {
    expect(() => admit({ sheets: [sheet()], ...metadata })).toThrow();
  });

  it.each([
    { visibility: "invisible" },
    { cells: [{ row: 0, column: 0, value: { kind: "blank" }, formula: 123 }] },
    { cells: [{ row: 0, column: 0, value: { kind: "blank" }, displayedText: true }] },
    { rows: [{ index: 0, sizePoints: "big" }] },
    { columns: [{ index: 0, hidden: "yes" }] },
    {
      formulaGroups: [
        {
          id: "g",
          kind: "other",
          expression: "1",
          range: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }
        }
      ]
    }
  ])("rejects malformed sheet metadata %#", (metadata) => {
    expect(() => admit({ sheets: [{ ...sheet(), ...metadata }] })).toThrow();
  });

  it("validates each rich text boundary against UTF-8 byte boundaries", () => {
    const cell = {
      row: 0,
      column: 0,
      value: { kind: "string", value: "🧪é" },
      richText: [{ start: 1, end: 4, attributes: {} }]
    };
    expect(() => admit({ sheets: [{ ...sheet(), cells: [cell] }] })).toThrow("rich text");
    expect(
      admit({
        sheets: [
          { ...sheet(), cells: [{ ...cell, richText: [{ start: 4, end: 6, attributes: {} }] }] }
        ]
      }).sheets[0]!.cells
    ).toHaveLength(1);
  });

  it("owns update inputs before invoking borrowed accessors", () => {
    let executions = 0;
    const book = {
      sheets: [
        Object.defineProperty(sheet(), "cells", {
          enumerable: true,
          get() {
            executions++;
            return [];
          }
        })
      ]
    };
    expect(() => updateWorkbook(book, [], limits)).toThrow("accessor");
    expect(executions).toBe(0);
  });

  it.each([
    { names: [null] },
    { names: {} },
    { iteration: null },
    { dependencies: [null] },
    { sheets: [{ ...sheet(), cells: [null] }] },
    {
      sheets: [
        { ...sheet(), cells: [{ row: 0, column: 0, value: { kind: "blank" }, richText: {} }] }
      ]
    },
    { sheets: [{ ...sheet(), rows: [null] }] },
    { sheets: [{ ...sheet(), merges: [null] }] },
    { sheets: [{ ...sheet(), formulaGroups: [null] }] }
  ])("preserves invalid-request diagnostics for malformed structure %#", (fields) => {
    expect(() => admit({ sheets: [sheet()], ...fields })).toThrowError(
      expect.objectContaining({ code: "invalid-request", exitCode: 1 })
    );
  });

  it("rejects non-array updates without evaluating foreign length", () => {
    let executions = 0;
    const updates = Object.defineProperty({}, "length", {
      get() {
        executions++;
        return 0;
      }
    });
    expect(() => updateWorkbook({ sheets: [sheet()] }, updates as never, limits)).toThrowError(
      expect.objectContaining({ code: "invalid-request" })
    );
    expect(executions).toBe(0);
  });

  it("rejects invalid and overflowing public ownership limits", () => {
    for (const invalidLimits of [
      { ...limits, cells: -1 },
      { ...limits, sheets: NaN },
      { ...limits, cells: Number.MAX_SAFE_INTEGER }
    ])
      expect(() => snapshotRecords([], invalidLimits)).toThrowError(
        expect.objectContaining({ code: "invalid-request" })
      );
  });

  it("rejects symbol records instead of silently dropping capability-bearing fields", () => {
    expect(() => snapshotRecords({ [Symbol("foreign")]: () => {} }, limits)).toThrow("symbol");
  });

  it("preserves invalid-request diagnostics for null updates", () => {
    expect(() => updateWorkbook({ sheets: [sheet()] }, [null] as never, limits)).toThrowError(
      expect.objectContaining({ code: "invalid-request" })
    );
  });

  it("requires mandatory public storage caps even when ownership caps are explicit", () => {
    const incomplete = { workbookNodes: 100, workbookTextBytes: 100 };
    expect(() => snapshotRecords([], incomplete as never)).toThrowError(
      expect.objectContaining({ code: "invalid-request" })
    );
    expect(() => snapshotWorkbook({ sheets: [sheet()] }, incomplete as never)).toThrowError(
      expect.objectContaining({ code: "invalid-request" })
    );
  });

  it.each([
    null,
    { source: 1, kind: "unknown", disposition: "retained" },
    { source: "fixture", kind: 2, disposition: "retained" },
    { source: "fixture", kind: "unknown", disposition: "stored" }
  ])(
    "rejects malformed imported record annotations in workbook and sheet scopes %#",
    (annotation) => {
      for (const book of [
        { sheets: [sheet()], unsupportedRecords: [annotation] },
        { sheets: [{ ...sheet(), unsupportedRecords: [annotation] }] }
      ])
        expect(() => admit(book)).toThrowError(
          expect.objectContaining({ code: "invalid-request" })
        );
    }
  );

  it("retains raw annotation data and preserves absent versus null payloads", () => {
    const records = [
      { source: "fixture", kind: "absent", disposition: "dropped" },
      { source: "fixture", kind: "null", disposition: "retained", data: null },
      {
        source: "fixture",
        kind: "vendor",
        disposition: "retained",
        data: { 未知: ["🧪", 1, false] }
      }
    ];
    const result = admit({ sheets: [sheet()], unsupportedRecords: records });
    expect(result.unsupportedRecords).toEqual(records);
    expect(Object.hasOwn(result.unsupportedRecords![0]!, "data")).toBe(false);
    expect(Object.hasOwn(result.unsupportedRecords![1]!, "data")).toBe(true);
  });

  it("charges merge comparisons across attached and detached sheets at exact boundaries", () => {
    const merges = [
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      { startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 }
    ];
    const book = {
      sheets: [{ ...sheet(), merges }],
      detachedSheets: [{ ...sheet(), id: "d", merges }]
    };
    expect(snapshotWorkbook(book, { ...limits, workbookWork: 2 }).detachedSheets).toHaveLength(1);
    expect(() => snapshotWorkbook(book, { ...limits, workbookWork: 1 })).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
    expect(
      snapshotWorkbook(
        { sheets: [{ ...sheet(), merges: merges.slice(0, 1) }] },
        { ...limits, workbookWork: 0 }
      ).sheets
    ).toHaveLength(1);
    expect(() =>
      snapshotWorkbook({ sheets: [{ ...sheet(), merges }] }, { ...limits, workbookWork: 0 })
    ).toThrow("work limit");
  });

  it("reports CLI work-limit exit1 without encoding, replacing output or adding namespace entries", async () => {
    const merges = [0, 2, 4].map((row) => ({
      startRow: row,
      endRow: row,
      startColumn: 0,
      endColumn: 1
    }));
    const volume = Volume.fromJSON({
      "/input.fixture": "original input",
      "/output.fixture": "keep output"
    });
    const effects: string[] = [],
      stderr: Uint8Array[] = [];
    const engine = createEngine({
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { ...limits, workbookWork: 2 },
      codecs: [
        {
          id: "fixture",
          description: "Small original in-memory merge fixture",
          extensions: ["fixture"],
          probeContent: () => true,
          async read() {
            return { sheets: [{ ...sheet(), merges }] };
          },
          async write() {
            effects.push("encode");
            return new Uint8Array();
          }
        }
      ],
      filesystem: {
        async read(uri) {
          return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
        },
        async write(uri, bytes) {
          effects.push("write");
          volume.writeFileSync(uri, bytes);
        }
      }
    });
    const before = volume.toJSON();
    const result = await runCommand(["/input.fixture", "/output.fixture"], engine, {
      signal: new AbortController().signal,
      stdout: {
        async write() {
          effects.push("stdout");
        }
      },
      stderr: {
        async write(bytes) {
          stderr.push(bytes.slice());
        }
      }
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(effects).toEqual([]);
    expect(stderr.map((bytes) => new TextDecoder().decode(bytes)).join("")).toBe(
      "ssconvert workbook work limit exceeded\n"
    );
    expect(volume.toJSON()).toEqual(before);
    await engine.dispose();
  });

  it("rejects invalid public relationship-work caps even with no comparisons", () => {
    for (const workbookWork of [-1, NaN, -Infinity, 0.5])
      expect(() =>
        snapshotWorkbook({ sheets: [sheet()] }, { ...limits, workbookWork })
      ).toThrowError(expect.objectContaining({ code: "invalid-request" }));
  });
});
