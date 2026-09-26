import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 20, sheets: 4, operations: 1000 } };
function fixture(variableRecords: number[] = [], rowLayouts: number[] = [], columnLayouts: number[] = []): Uint8Array {
  const bytes = new Uint8Array(1000); bytes.set(psionFixture());
  const v = new DataView(bytes.buffer); v.setUint32(77, 500, true); v.setUint32(124, 600, true); v.setUint32(128, 700, true);
  bytes.set([2, variableRecords.length ? 2 : 0, ...variableRecords], 500);
  bytes.set([2, rowLayouts.length ? 2 : 0, ...rowLayouts], 600);
  bytes.set([2, columnLayouts.length ? 2 : 0, ...columnLayouts], 700);
  return bytes;
}
const variable = (type: number, data: number[]) => [6, 88, type, ...data, 0, 0, 0, 0];

it.each([[0, [2, 0, 0, 128]], [1, [0, 0, 0, 0, 0, 0, 248, 63]], [2, [6, 65]],
  [3, [0, 0, 0, 0, 0, 0, 0, 0, 0]], [4, [0, ...Array<number>(16).fill(0)]]])
  ("Psion variable type %i structurally parses while Gnumeric leaves names absent", async (type, data) => {
    const book = await readPsion(fixture(variable(Number(type), data as number[])), context);
    expect(book.names).toBeUndefined();
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  });

it("Psion unknown variable types reject corrupted input", async () => {
  await expect(readPsion(fixture(variable(5, [])), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion row number format takes precedence over column format for populated cells", async () => {
  const book = await readPsion(fixture([], [0, 2, 4, 0, 2, 4], [0, 2, 4, 0, 8, 4]), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.00");
});

it("Psion column number format supplies populated cells without a row override", async () => {
  const book = await readPsion(fixture([], [], [0, 2, 4, 0, 8, 4]), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.00%");
});

it("Psion empty paragraph line layouts preserve inherited number format", async () => {
  const book = await readPsion(fixture([], [0, 2, 1]), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("General");
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion variable ranges require all four coordinate words before their trailer", async () => {
  const bytes = fixture(variable(4, [0, ...Array<number>(16).fill(0)]));
  await expect(readPsion(bytes.slice(0, 517), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion out-of-range row layouts do not create cells or change the namespace", async () => {
  const bytes = fixture([], [3, 0, 8, 0, 2, 4, 0, 8, 4]);
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells).toHaveLength(1);
  expect(book.sheets[0]!.cells[0]!.format).toBe("General");
  expect(book.names).toBeUndefined();
});

it("Psion duplicate line formats preserve the first source definition", async () => {
  const bytes = fixture([], [0, 2, 4, 0, 2, 4, 0, 2, 4, 0, 8, 4]); bytes[601] = 4;
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.00");
});

it("Psion explicit cell format overrides inherited line format", async () => {
  const bytes = fixture([], [0, 2, 4, 0, 2, 4]); bytes[166] = 48; bytes.set([2, 4, 0, 8, 4], 171);
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.00%");
});

it("Psion rejects truncated variable payloads", async () => {
  await expect(readPsion(fixture(variable(1, Array<number>(8).fill(0))).slice(0, 507), context))
    .rejects.toThrow("Error while parsing Psion file.");
});

it("Psion rejects truncated line format payloads", async () => {
  await expect(readPsion(fixture([], [0, 2, 4, 0, 2, 4]).slice(0, 607), context))
    .rejects.toThrow("Error while parsing Psion file.");
});

it("Psion structural records consume the injected cumulative operation budget", async () => {
  await expect(readPsion(fixture(variable(2, [6, 65])), { ...context, limits: { ...context.limits, operations: 60 } }))
    .rejects.toThrow("operations limit exceeded");
});
