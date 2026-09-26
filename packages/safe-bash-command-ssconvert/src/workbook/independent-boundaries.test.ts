import { describe, expect, it } from "vitest";
import { formatA1, parseA1, snapshotRecords, snapshotWorkbook, updateWorkbook } from "./model.js";
import { createEngine } from "../engine.js";

const limits = { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 3, operations: 10 };

describe("independent workbook boundary controls", () => {
  it("never executes inherited budget accessors after admitting own fields", () => {
    let executions = 0;
    const inherited = Object.create(null);
    for (const key of ["workbookNodes", "workbookTextBytes", "workbookWork"])
      Object.defineProperty(inherited, key, {
        get() {
          executions++;
          return 10000;
        }
      });
    const borrowedLimits = Object.assign(Object.create(inherited), limits);
    expect(snapshotRecords([], borrowedLimits)).toEqual([]);
    expect(snapshotWorkbook({ sheets: [] }, borrowedLimits)).toEqual({ sheets: [] });
    expect(updateWorkbook({ sheets: [] }, [], borrowedLimits)).toEqual({ sheets: [] });
    expect(executions).toBe(0);
  });

  it("round trips independently selected A1 edges and rejects their next neighbors", () => {
    for (const [address, row, column] of [
      ["A1", 0, 0], ["Z128", 127, 25], ["AA129", 128, 26],
      ["IV65536", 65535, 255], ["XFD16777216", 16777215, 16383]
    ] as const) {
      expect(parseA1(address)).toEqual({ row, column });
      expect(formatA1(row, column)).toBe(address);
    }
    for (const address of ["XFE1", "A16777217", "A0", "A01", "$$A1", "A1 ", "Ａ1", "A١"])
      expect(() => parseA1(address)).toThrow("A1");
  });

  it("keeps failed detached updates atomic and counts detached populated storage", () => {
    const book = {
      sheets: [{ id: "a", name: "same", cells: [] }],
      detachedSheets: [{ id: "d", name: "same", cells: [{ row: 0, column: 0, value: { kind: "blank" as const } }] }]
    };
    const before = structuredClone(book);
    expect(() => updateWorkbook(book, [{ sheet: "d", row: 0, column: 0, value: { kind: "number", value: 3 } }], limits))
      .toThrow("Unknown sheet: d");
    expect(() => updateWorkbook(book, [{ sheet: "a", row: 0, column: 0, value: { kind: "blank" } }], { ...limits, cells: 1 }))
      .toThrow("cells limit");
    expect(book).toEqual(before);
  });

  it("charges text byte boundaries independently of UTF-16 length", () => {
    expect(snapshotRecords("é🧪", { ...limits, workbookTextBytes: 6 })).toBe("é🧪");
    expect(() => snapshotRecords("é🧪", { ...limits, workbookTextBytes: 5 })).toThrow("text limit");
  });

  it("requires the attribute record carried by each rich-text run", () => {
    const book = {
      sheets: [{ id: "s", name: "s", cells: [{
        row: 0, column: 0, value: { kind: "string" as const, value: "é" },
        richText: [{ start: 0, end: 2 }]
      }] }]
    };
    expect(() => snapshotWorkbook(book as never, limits)).toThrowError(
      expect.objectContaining({ code: "invalid-request", exitCode: 1 })
    );
    const valid = structuredClone(book);
    Object.assign(valid.sheets[0]!.cells[0]!.richText[0]!, { attributes: {} });
    expect(snapshotWorkbook(valid as never, limits)).toEqual(valid);
  });

  it("owns admitted SDK read and write resource identities before deferred host work", async () => {
    const reads: string[] = [], writes: string[] = [], encodedOptions: string[][] = [];
    const engine = createEngine({
      limits, environment: { env: {}, locale: "C", timezone: "UTC" },
      codecs: [{
        id: "fixture", description: "Original memory fixture", extensions: ["fixture"],
        async exportOptions(options) { return [...options]; },
        probeContent: () => true,
        async read() { return { sheets: [] }; },
        async write(_book, options) {
          encodedOptions.push([...options]);
          return new Uint8Array();
        }
      }],
      filesystem: {
        async read(uri) { reads.push(uri); return []; },
        async write(uri) { writes.push(uri); }
      }
    });
    const operation = { signal: new AbortController().signal };
    const input = { kind: "resource" as const, uri: "/admitted.fixture" };
    const reading = engine.readWorkbook(input, {}, operation);
    input.uri = "/foreign.fixture";
    const book = await reading;
    const destination = { kind: "resource" as const, uri: "/admitted-output.fixture" };
    const options = { exportType: "fixture", exportOptions: ["admitted"] };
    const writing = engine.writeWorkbook(book, destination, options, operation);
    destination.uri = "/foreign-output.fixture";
    options.exportOptions[0] = "foreign";
    await writing;
    await engine.dispose();
    expect({ reads, writes, encodedOptions }).toEqual({
      reads: ["/admitted.fixture"],
      writes: ["/admitted-output.fixture"],
      encodedOptions: [["admitted"]]
    });
  });
});
