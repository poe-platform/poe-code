import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  createEngine,
  formatA1,
  getCell,
  getCellsExtent,
  parseA1,
  resolveName,
  snapshotWorkbook,
  updateWorkbook,
  validSheetSize,
  type Workbook,
  type Codec
} from "./index.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 20, sheets: 5, operations: 30 };
const sheet = (id = "s") => ({ id, name: id, size: { rows: 128, columns: 128 }, cells: [] });

describe("sparse workbook invariants", () => {
  it("calculates stored-cell dimensions including blanks and hidden cells without styles or merges extending them", () => {
    expect(getCellsExtent(sheet())).toEqual({
      startRow: 127,
      startColumn: 127,
      endRow: 0,
      endColumn: 0
    });
    expect(
      getCellsExtent({
        ...sheet(),
        rows: [{ index: 10, hidden: true }],
        merges: [{ startRow: 0, startColumn: 0, endRow: 100, endColumn: 100 }],
        cells: [
          { row: 10, column: 20, value: { kind: "blank" } },
          { row: 2, column: 30, value: { kind: "string", value: "" } }
        ]
      })
    ).toEqual({ startRow: 2, startColumn: 20, endRow: 10, endColumn: 30 });
  });
  it("keeps missing, blank, empty string, displayed text and style distinct", () => {
    const book = snapshotWorkbook(
      {
        sheets: [
          {
            ...sheet(),
            cells: [
              { row: 0, column: 0, value: { kind: "blank" }, style: { background: "red" } },
              { row: 0, column: 1, value: { kind: "string", value: "" }, displayedText: "label" },
              { row: 0, column: 2, value: { kind: "number", value: 60 }, format: "yyyy-mm-dd" },
              { row: 0, column: 3, value: { kind: "boolean", value: false } },
              { row: 0, column: 4, value: { kind: "error", value: "#REF!" } }
            ]
          }
        ],
        dateSystem: "1900"
      },
      limits
    );
    expect(getCell(book.sheets[0]!, 1, 0)).toBeUndefined();
    expect(getCell(book.sheets[0]!, 0, 0)?.value).toEqual({ kind: "blank" });
    expect(getCell(book.sheets[0]!, 0, 1)).toMatchObject({
      value: { kind: "string", value: "" },
      displayedText: "label"
    });
    expect(getCell(book.sheets[0]!, 0, 2)?.value).toEqual({ kind: "number", value: 60 });
    expect(book.sheets[0]!.cells).toHaveLength(5);
  });
  it("handles Gnumeric A1 maxima, absolute addresses and minimal dimensions without grid allocation", () => {
    expect(parseA1("$xFd$16777216")).toEqual({ row: 16777215, column: 16383 });
    expect(formatA1(16777215, 16383)).toBe("XFD16777216");
    for (const address of [
      "XFE1",
      "A16777217",
      "A0",
      "A01",
      "1A",
      "A1x",
      "A",
      "Ａ1",
      "A-1",
      "A1\n"
    ])
      expect(() => parseA1(address)).toThrow();
    for (const size of [
      { rows: 127, columns: 128 },
      { rows: 129, columns: 128 },
      { rows: 128, columns: 32768 }
    ])
      expect(validSheetSize(size)).toBe(false);
    const book = snapshotWorkbook(
      { sheets: [{ ...sheet(), size: { rows: 16777216, columns: 16384 } }] },
      { ...limits, cells: 0 }
    );
    expect(book.sheets[0]!.cells).toEqual([]);
    expect(() =>
      snapshotWorkbook(
        { sheets: [{ ...sheet(), cells: [{ row: 128, column: 0, value: { kind: "blank" } }] }] },
        limits
      )
    ).toThrow("Invalid cell address");
  });
  it("resolves exact-spelling names with local shadowing and detects same-scope conflicts", () => {
    const book = snapshotWorkbook(
      {
        sheets: [sheet()],
        names: [
          { name: "Δ🧪", expression: "1" },
          { name: "Δ🧪", sheet: "s", expression: "2" },
          { name: "δ🧪", expression: "3" },
          { name: "__proto__", expression: "4" }
        ]
      },
      limits
    );
    expect(resolveName(book, "Δ🧪", "s")?.expression).toBe("2");
    expect(resolveName(book, "Δ🧪", "unknown")?.expression).toBe("1");
    expect(resolveName(book, "δ🧪")?.expression).toBe("3");
    expect(() =>
      snapshotWorkbook({ ...book, names: [...book.names!, book.names![0]!] }, limits)
    ).toThrow("Conflicting named expression");
    expect(() =>
      snapshotWorkbook(
        { ...book, names: [{ name: "n", sheet: "missing", expression: "1" }] },
        limits
      )
    ).toThrow("scope");
  });
  it("rejects case-folded sheet conflicts while retaining arbitrary Unicode spelling", () => {
    for (const [a, b] of [
      ["表ABC", "表abc"],
      ["Straße", "STRASSE"],
      ["Σ", "ς"]
    ])
      expect(() =>
        snapshotWorkbook(
          {
            sheets: [
              { ...sheet("a"), name: a! },
              { ...sheet("b"), name: b! }
            ]
          },
          limits
        )
      ).toThrow("Conflicting sheet name");
    const book = snapshotWorkbook({ sheets: [{ ...sheet(), name: "'表 🧪 / : ?'" }] }, limits);
    expect(book.sheets[0]!.name).toBe("'表 🧪 / : ?'");
  });
  it("preserves detached sheet scopes, ordered sheets and metadata during content transfer", () => {
    const book: Workbook = {
      sheets: [
        { ...sheet("b"), visibility: "very-hidden" },
        { ...sheet("a"), visibility: "hidden" }
      ],
      detachedSheets: [sheet("detached")],
      activeSheet: "a",
      view: { zoom: 1.5 },
      names: [{ name: "n", sheet: "detached", expression: "1" }],
      dependencies: [
        {
          dependent: { sheet: "a", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
          precedent: { sheet: "detached", startRow: 1, startColumn: 1, endRow: 2, endColumn: 2 }
        }
      ],
      calculationMode: "manual",
      iteration: { enabled: true, maximum: 100, tolerance: 0.001 },
      properties: { title: "original", vector: [1, true] },
      unsupportedRecords: [
        { source: "fixture", kind: "vendor", disposition: "retained", data: { opaque: "x" } }
      ]
    };
    const result = updateWorkbook(
      book,
      [
        { sheet: "a", row: 0, column: 0, value: { kind: "number", value: 1 } },
        { sheet: "a", row: 0, column: 0, value: { kind: "number", value: 2 } }
      ],
      limits
    );
    expect(result).toMatchObject({
      ...book,
      sheets: [{ id: "b" }, { id: "a", cells: [{ value: { value: 2 } }] }]
    });
    expect(result.sheets.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(result.sheets[1]!.cells).toHaveLength(1);
    expect(book.sheets[1]!.cells).toEqual([]);
    expect(() =>
      updateWorkbook(
        result,
        [{ sheet: "detached", row: 0, column: 0, value: { kind: "blank" } }],
        limits
      )
    ).toThrow("Unknown sheet");
    expect(() => snapshotWorkbook({ ...book, activeSheet: "detached" }, limits)).toThrow(
      "active sheet"
    );
  });
  it("round trips formula groups, cache presence, rich text, row/column metadata and merges through memfs", async () => {
    const range = { startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 };
    const original: Workbook = {
      sheets: [
        {
          ...sheet(),
          rows: [{ index: 5, hidden: true, sizePoints: 12 }],
          columns: [{ index: 1, outlineLevel: 2, collapsed: true }],
          merges: [{ ...range, startRow: 5, endRow: 6 }],
          formulaGroups: [
            { id: "array", kind: "array", range, expression: "1+1" },
            {
              id: "shared",
              kind: "shared",
              range: { ...range, startRow: 2, endRow: 2 },
              expression: "A1"
            }
          ],
          cells: [
            { row: 0, column: 0, value: { kind: "blank" }, formula: "1+1", formulaGroup: "array" },
            {
              row: 0,
              column: 1,
              value: { kind: "blank" },
              formulaGroup: "array",
              cachedResult: { kind: "blank" }
            },
            {
              row: 2,
              column: 0,
              value: { kind: "number", value: 2 },
              formulaGroup: "shared",
              cachedResult: { kind: "number", value: 2 }
            },
            {
              row: 3,
              column: 0,
              value: { kind: "string", value: "🧪é" },
              richText: [{ start: 0, end: 4, attributes: { weight: 700 } }]
            }
          ]
        }
      ],
      dateSystem: "1904"
    };
    const volume = Volume.fromJSON({ "/input.fixture": JSON.stringify(original) });
    const codec: Codec = {
      id: "fixture",
      description: "Original JSON fixture, not a product format",
      extensions: ["fixture"],
      probeContent: () => true,
      async read(bytes) {
        return JSON.parse(new TextDecoder().decode(bytes)) as Workbook;
      },
      async write(book) {
        return new TextEncoder().encode(JSON.stringify(book));
      }
    };
    const engine = createEngine({
      codecs: [codec],
      limits,
      environment: { env: {}, locale: "C", timezone: "UTC" },
      filesystem: {
        async read(uri) {
          return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
        },
        async write(uri, bytes) {
          volume.writeFileSync(uri, bytes);
        }
      }
    });
    const operation = { signal: new AbortController().signal };
    await engine.convert(
      {
        input: { kind: "resource", uri: "/input.fixture" },
        destination: { kind: "resource", uri: "/output.fixture" }
      },
      operation
    );
    const result = await engine.readWorkbook(
      { kind: "resource", uri: "/output.fixture" },
      {},
      operation
    );
    expect(result).toEqual(original);
    expect(Object.hasOwn(result.sheets[0]!.cells[0]!, "cachedResult")).toBe(false);
    expect(Object.hasOwn(result.sheets[0]!.cells[1]!, "cachedResult")).toBe(true);
    expect(Object.isFrozen(result.sheets[0]!.cells[3]!.richText![0]!.attributes)).toBe(true);
    await engine.dispose();
  });
  it("rejects conflicting metadata and formula relationships", () => {
    for (const partial of [
      { rows: [{ index: 1 }, { index: 1 }] },
      { columns: [{ index: 128 }] },
      {
        merges: [
          { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
          { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 }
        ]
      },
      { cells: [{ row: 0, column: 0, value: { kind: "blank" as const }, formulaGroup: "missing" }] }
    ])
      expect(() => snapshotWorkbook({ sheets: [{ ...sheet(), ...partial }] }, limits)).toThrow();
  });
  it("bounds nested ownership and rejects cycles and foreign capabilities", () => {
    expect(() => snapshotWorkbook({ sheets: [sheet()] }, { ...limits, workbookNodes: 1 })).toThrow(
      "nodes limit"
    );
    expect(() =>
      snapshotWorkbook({ sheets: [sheet()] }, { ...limits, workbookTextBytes: 1 })
    ).toThrow("text limit");
    const properties: Record<string, unknown> = {};
    properties.cycle = properties;
    expect(() => snapshotWorkbook({ sheets: [], properties } as Workbook, limits)).toThrow(
      "Cyclic"
    );
    expect(() =>
      snapshotWorkbook(
        { sheets: [], properties: { callback: () => {} } } as unknown as Workbook,
        limits
      )
    ).toThrow("Unsupported");
  });
  it("bounds merge relationship work independently of sparse storage", () => {
    const book: Workbook = {
      sheets: [
        {
          ...sheet(),
          merges: Array.from({ length: 10 }, (_, row) => ({
            startRow: row,
            endRow: row,
            startColumn: 0,
            endColumn: 1
          }))
        }
      ]
    };
    expect(() => snapshotWorkbook(book, { ...limits, workbookWork: 5 })).toThrow("work limit");
    expect(snapshotWorkbook(book, { ...limits, workbookWork: 1000 })).toEqual(book);
  });
});

describe("workbook retention regression", () => {
  it("retains workbook metadata and owns nested cell records across updates", async () => {
    const imported = {
      sheets: [
        {
          id: "s",
          name: "表 🧪",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string" as const, value: "" },
              richText: [{ start: 0, end: 0, attributes: { weight: 700 } }]
            }
          ]
        }
      ],
      dateSystem: "1904" as const,
      properties: { title: "original" },
      activeSheet: "s",
      names: [{ name: "Δ", expression: "1" }]
    };
    let exported: Workbook | undefined;
    const codec: Codec = {
      id: "fixture",
      description: "in-memory",
      extensions: ["fixture"],
      probeContent: () => true,
      async read() {
        return imported;
      },
      async write(book) {
        exported = book;
        return new Uint8Array();
      }
    };
    const engine = createEngine({
      codecs: [codec],
      limits: { inputBytes: 10, outputBytes: 10, cells: 10, sheets: 2, operations: 10 },
      environment: { env: {}, locale: "C", timezone: "UTC" }
    });
    const operation = { signal: new AbortController().signal };
    const book = await engine.readWorkbook(
      { kind: "stream", source: [], filename: "a.fixture" },
      {},
      operation
    );
    imported.sheets[0]!.cells[0]!.richText[0]!.attributes.weight = 400;
    expect(book).toMatchObject({
      dateSystem: "1904",
      properties: { title: "original" },
      sheets: [{ cells: [{ richText: [{ attributes: { weight: 700 } }] }] }]
    });
    await engine.convert(
      {
        input: { kind: "stream", source: [], filename: "a.fixture" },
        destination: { kind: "stream", sink: { async write() {} } },
        exportType: "fixture",
        updates: [{ sheet: "s", row: 1, column: 0, value: { kind: "blank" } }]
      },
      operation
    );
    expect(exported).toMatchObject({
      dateSystem: "1904",
      activeSheet: "s",
      names: [{ name: "Δ" }]
    });
    await engine.dispose();
  });
});
