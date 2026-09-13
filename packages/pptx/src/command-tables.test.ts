import { createHash } from "node:crypto";
import { addTable, mutateTables, readTables } from "./table-operations.js";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { compileJsonSchema } from "toolcraft-schema";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
async function fixture() {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", await createPresentation({ slides: [{}] }, context));
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  });
  const readInput = vi.fn(async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer));
  return {
    fs,
    readInput,
    run: async (args: string[]) => {
      const result = await engine.execute({
        args: [...args, "--json"].map((x) => new TextEncoder().encode(x)),
        signal: new AbortController().signal,
        readInput,
        publishOutput: async (p) => {
          if (!p.dryRun) fs.writeFileSync(p.outputPath, p.bytes);
        }
      });
      return { code: result.exitCode, value: JSON.parse(new TextDecoder().decode(result.stdout)) };
    }
  };
}
const add = [
  "tables",
  "add",
  "/deck.pptx",
  "--slide",
  "1",
  "--rows",
  "2",
  "--columns",
  "2",
  "--left",
  "0emu",
  "--top",
  "0emu",
  "--width",
  "11emu",
  "--height",
  "7emu",
  "--data",
  '[["North",""],["South","East"]]',
  "--in-place"
];
it("creates a rectangular table and edits one logical cell with exact sizes", async () => {
  const { run, fs } = await fixture();
  const created = await run(add);
  expect(created.code, JSON.stringify(created.value)).toBe(0);
  expect(created.value).toMatchObject({ operation: "tables.add", affected: 1, ok: true });
  const before = await run(["tables", "get", "/deck.pptx", "--slide", "1", "--table", "1"]);
  expect(before.code, JSON.stringify(before.value)).toBe(0);
  expect(before.value.data.records[0]).toMatchObject({
    rows: 2,
    columns: 2,
    columnWidths: [6, 5],
    rowHeights: [4, 3],
    data: [
      ["North", ""],
      ["South", "East"]
    ]
  });
  const resultSchema = (await run(["schema", "tables", "get"])).value.data.operations["tables.get"]
    .result;
  expect(compileJsonSchema(resultSchema).validate(before.value).ok).toBe(true);
  const changed = await run([
    "tables",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--table",
    "1",
    "--cell",
    "2,1",
    "--text",
    "",
    "--row-height",
    "10emu",
    "--column-width",
    "12emu",
    "--margin-left",
    "2emu",
    "--fill",
    "ABCDEF",
    "--border-color",
    "112233",
    "--border-width",
    "1emu",
    "--in-place"
  ]);
  expect(changed.code, JSON.stringify(changed.value)).toBe(0);
  const after = await run(["tables", "get", "/deck.pptx", "--slide", "1", "--table", "1"]);
  expect(after.value.data.records[0]).toMatchObject({
    data: [
      ["North", ""],
      ["", "East"]
    ],
    columnWidths: [12, 5],
    rowHeights: [4, 10]
  });
  const bytes = new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
  const noop = await run([
    "tables",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--table",
    "1",
    "--cell",
    "2,1",
    "--text",
    "",
    "--in-place"
  ]);
  expect(noop.code, JSON.stringify(noop.value)).toBe(0);
  expect(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)).toEqual(bytes);
});
it("validates table schemas and usage before acquiring input", async () => {
  const { run, readInput } = await fixture();
  const schema = (await run(["schema", "tables", "set"])).value.data.operations["tables.set"]
    .options;
  const check = compileJsonSchema(schema);
  expect(check.validate({ slide: 1, table: 1, cell: "1,1", text: "", dryRun: true }).ok).toBe(true);
  expect(check.validate({ slide: 1, table: 1, rows: 0, dryRun: true }).ok).toBe(false);
  for (const tail of [
    ["--rows", "0"],
    ["--table", "0"],
    ["--cell", "0,1"],
    ["--data", "[[3]]"],
    ["--margin-left", "-1emu"]
  ]) {
    const result = await run(["tables", "set", "/deck.pptx", "--slide", "1", ...tail, "--dry-run"]);
    expect(result.code, JSON.stringify(result.value)).toBe(2);
  }
  expect(readInput).not.toHaveBeenCalled();
});
it("rejects a shape selector and mismatched dimensions without publication", async () => {
  const { run, fs } = await fixture();
  await run(add);
  const bytes = new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
  expect(
    (
      await run([
        "tables",
        "set",
        "/deck.pptx",
        "--slide",
        "1",
        "--table",
        "1",
        "--rows",
        "3",
        "--in-place"
      ])
    ).code
  ).toBe(1);
  expect(
    (
      await run([
        "tables",
        "set",
        "/deck.pptx",
        "--slide",
        "1",
        "--shape",
        "Table 2",
        "--text",
        "X",
        "--in-place"
      ])
    ).code
  ).toBe(2);
  expect(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)).toEqual(bytes);
});

it("uses the same table behavior through explicit byte SDK inputs", async () => {
  const original = await createPresentation({ slides: [{}] }, context);
  const added = await addTable(
    original,
    {
      slide: 1,
      update: {
        rows: 1,
        columns: 2,
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 9, unit: "emu" },
        height: { value: 7, unit: "emu" },
        data: [["Cove", ""]]
      }
    },
    context
  );
  const records = await readTables(added.bytes, { slide: 1, table: 1 }, context);
  expect(records[0]).toMatchObject({ data: [["Cove", ""]], columnWidths: [5, 4], rowHeights: [7] });
  const changed = await mutateTables(
    added.bytes,
    { slide: 1, table: 1, cell: "1,2", update: { text: "船" } },
    context
  );
  expect((await readTables(changed.bytes, {}, context))[0]!.data).toEqual([["Cove", "船"]]);
  await expect(
    mutateTables(changed.bytes, { select: records[0]!.token, update: { style: "custom" } }, context)
  ).rejects.toMatchObject({ code: "stale-selection" });
  expect(await readTables(original, {}, context)).toEqual([]);
});
it("rejects SDK getters and invalid selectors before input reads", async () => {
  const read = vi.fn(async () => null),
    getter = vi.fn(() => "Unexpected");
  const update = Object.defineProperty({}, "text", { enumerable: true, get: getter });
  await expect(
    mutateTables({ read }, { slide: 1, table: 1, cell: "1,1", update }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(getter).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  for (const options of [{ table: 0 }, { cell: "1,0" }, { all: "false" }, { scope: "masters" }])
    await expect(readTables({ read }, options as never, context)).rejects.toBeDefined();
  expect(read).not.toHaveBeenCalled();
});
it("creates with explicit cell text through the common selector", async () => {
  const { run } = await fixture();
  const args = add.filter((_, i) => i !== add.indexOf("--data") && i !== add.indexOf("--data") + 1);
  const result = await run([...args, "--cell", "1,2", "--text", "Pebble"]);
  expect(result.code, JSON.stringify(result.value)).toBe(0);
  const table = await run(["tables", "get", "/deck.pptx", "--slide", "1", "--table", "1"]);
  expect(table.value.data.records[0].data).toEqual([
    ["", "Pebble"],
    ["", ""]
  ]);
});
it("bounds repeated XML parsing when a slide has many unrelated drawings", async () => {
  const xmlModule = await import("./xml.js");
  const bytes = await createPresentation(
    {
      slides: [
        {
          shapes: Array.from({ length: 25 }, (_, i) => ({
            name: `Inspection item ${i}`,
            text: "",
            x: 0,
            y: 0,
            width: 2,
            height: 2
          }))
        }
      ]
    },
    context
  );
  const parse = vi.spyOn(xmlModule, "parseXmlPart");
  try {
    expect(await readTables(bytes, { slide: 1 }, context)).toEqual([]);
    const matching = parse.mock.calls.filter(([input]) =>
      new TextDecoder().decode(input).includes("Inspection item 0")
    );
    expect(matching.length).toBeLessThanOrEqual(4);
  } finally {
    parse.mockRestore();
  }
});
it("retains original archive ordering and metadata on a no-op table edit", async () => {
  const { storedArchive } = await import("../tests/fixtures/archive.js");
  const { readPackage } = await import("./package-reader.js");
  const bytes = await createPresentation({ slides: [{}] }, context);
  const table = await addTable(
    bytes,
    {
      slide: 1,
      update: {
        rows: 1,
        columns: 1,
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 3, unit: "emu" },
        height: { value: 2, unit: "emu" }
      }
    },
    context
  );
  const archive = await readPackage(table.bytes, context);
  const source = storedArchive(
    [...archive.names]
      .reverse()
      .map((name) => ({ name: name.slice(1), bytes: archive.get(name), mode: 0o100600 }))
  );
  const noop = await mutateTables(
    source,
    { slide: 1, table: 1, cell: "1,1", update: { text: "" } },
    context
  );
  expect(createHash("sha256").update(noop.bytes).digest("hex")).toBe(
    createHash("sha256").update(source).digest("hex")
  );
});
