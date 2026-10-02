import { expect, it, beforeAll, afterAll, vi } from "vitest";
import { createPptxCommandEngine } from "./command-engine.js";

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

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it.each(["images", "tables", "charts"])(
  "rejects placeholder geometry before input reads for %s",
  async (resource) => {
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 262144
    });
    const values =
      resource === "images"
        ? ["--file", "dot.gif"]
        : resource === "tables"
          ? ["--rows", "2", "--columns", "2"]
          : ["--type", "COLUMN_CLUSTERED", "--data", "{}"];
    let reads = 0;
    const result = await engine.execute({
      args: [
        resource,
        "add",
        "deck",
        "--slide",
        "1",
        "--placeholder",
        "0",
        "--width",
        "1in",
        ...values,
        "--dry-run",
        "--json"
      ].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async () => {
        reads++;
        return new Uint8Array();
      }
    });
    expect(reads).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain(
      "Placeholder insertion uses inherited geometry"
    );
  }
);

it.each(["tables", "images", "charts"])(
  "inserts sparse %s placeholders through the SDK and preserves IDs",
  async (resource) => {
    const { Volume } = await import("memfs");
    const { createPresentation } = await import("./creation.js");
    const { loadShared, required } = await import("./masters.js");
    const { Presentation } = await import("./presentation-model.js");
    const source = await createPresentation(
      { slides: [{ shapes: [{ x: 10, y: 20, width: 300, height: 200, text: "Slot" }] }] },
      context
    );
    const state = await loadShared(source, context);
    const part = state.index.inventory.slides[0]!.part;
    const xml = state.doc(part);
    const tree = required(required(xml.root, "cSld"), "spTree");
    const shape = tree.children.find((node) => node.name.localName === "sp")!;
    const nv = required(required(shape, "nvSpPr"), "nvPr");
    state.save(
      part,
      xml.spliceChildren(nv, 0, 0, [
        `<p:ph xmlns:p="${shape.name.namespace}" idx="10" type="${resource === "tables" ? "tbl" : resource === "images" ? "pic" : "chart"}"/>`
      ])
    );
    const prepared = (await state.finish(part, [1])).bytes;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/deck", prepared);
    volume.writeFileSync(
      "/dot.png",
      new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15,
        0, 3, 199, 2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
      ])
    );
    const values =
      resource === "tables"
        ? ["--rows", "2", "--columns", "3"]
        : resource === "images"
          ? ["--file", "/dot.png"]
          : [
              "--type",
              "COLUMN_CLUSTERED",
              "--data",
              JSON.stringify({ categories: ["A"], series: [{ name: "Series", values: [2] }] })
            ];
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 262144
    });
    const result = await engine.execute({
      args: [
        resource,
        "add",
        "/deck",
        "--slide",
        "1",
        "--placeholder",
        "10",
        ...values,
        "--output",
        "/result",
        "--json"
      ].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput: async (output) => {
        volume.writeFileSync(output.outputPath, output.bytes);
      }
    });
    expect(result.exitCode, new TextDecoder().decode(result.stdout)).toBe(0);
    const deck = await Presentation(
      new Uint8Array(volume.readFileSync("/result") as Buffer),
      context
    );
    const frame = deck.slides.get(0).placeholders.get(10);
    expect(frame.shape_id).toBe(2);
    expect(frame.has_table).toBe(resource === "tables");
    expect(frame.has_chart).toBe(resource === "charts");
  }
);

it.each([
  null,
  { slide: 1, placeholder: 0, content: { kind: "unknown" } },
  { slide: 1, placeholder: 4294967296, content: { kind: "table", rows: 1, columns: 1 } },
  { slide: 1, placeholder: 0, content: { kind: "table", rows: 0, columns: 1 } },
  { slide: 1, placeholder: 0, content: { kind: "table", rows: 1, columns: 1, unknown: true } },
  { slide: 1, placeholder: 0, content: { kind: "chart", type: "unknown", data: {} } },
  { slide: 1, placeholder: 0, content: { kind: "picture", input: new Uint8Array(), altText: 3 } },
  { slide: 1, placeholder: 0, content: { kind: "table", rows: 1, columns: 1 }, extra: true }
])("rejects invalid placeholder SDK options before opening document %j", async (options) => {
  const { insertPlaceholder } = await import("./command-placeholder.js");
  await expect(
    insertPlaceholder(new Uint8Array(), options as never, context)
  ).rejects.toMatchObject({ code: "invalid-value", phase: "usage" });
});

it.each(["images", "tables", "charts"])(
  "publishes placeholder selection in %s schema",
  async (resource) => {
    const { compileJsonSchema } = await import("toolcraft-schema");
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 262144
    });
    const result = await engine.execute({
      args: ["schema", resource, "add", "--json"].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async () => {
        throw Error("Unexpected read");
      }
    });
    const schema = JSON.parse(new TextDecoder().decode(result.stdout)).data.operations[
      resource + ".add"
    ].options;
    const validate = compileJsonSchema(schema);
    const data =
      resource === "images"
        ? { file: "dot.png" }
        : resource === "tables"
          ? { rows: 2, columns: 3 }
          : {
              type: "COLUMN_CLUSTERED",
              data: { categories: ["A"], series: [{ name: "Series", values: [1] }] }
            };
    expect(validate.validate({ ...data, slide: 1, placeholder: 10, dryRun: true }).ok).toBe(true);
    expect(
      validate.validate({
        ...data,
        slide: 1,
        placeholder: 10,
        width: { value: 1, unit: "in" },
        dryRun: true
      }).ok
    ).toBe(false);
  }
);
