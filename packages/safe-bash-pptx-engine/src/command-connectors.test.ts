import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readShapes } from "./shape-operations.js";
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
  fs.writeFileSync(
    "/deck.pptx",
    await createPresentation(
      {
        slides: [
          { shapes: [{ name: "Target", x: 0, y: 0, width: 100, height: 100, text: "Target" }] }
        ]
      },
      context
    )
  );
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  });
  let reads = 0;
  const run = async (args: string[]) => {
    const result = await engine.execute({
      args: [...args, "--json"].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => {
        reads++;
        return new Uint8Array(fs.readFileSync(path) as Buffer);
      },
      publishOutput: async (p) => {
        if (!p.dryRun) fs.writeFileSync(p.outputPath, p.bytes);
      }
    });
    return { code: result.exitCode, value: JSON.parse(new TextDecoder().decode(result.stdout)) };
  };
  return {
    run,
    reads: () => reads,
    bytes: () => new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)
  };
}

it("discovers connector schemas and rejects incomplete creation before input reads", async () => {
  const f = await fixture();
  for (const action of ["list", "get", "add", "set", "remove"]) {
    const schema = await f.run(["schema", "connectors", action]);
    expect(schema.code).toBe(0);
    expect(schema.value.data.operations[`connectors.${action}`]).toBeDefined();
    const validate = compileJsonSchema(
      schema.value.data.operations[`connectors.${action}`].options
    );
    if (action === "set") {
      expect(
        validate.validate({ slide: 1, dryRun: true, beginX: { value: 0, unit: "emu" } }).ok
      ).toBe(true);
      for (const update of [
        { lineColor: "red" },
        { site: -1 },
        { site: 0 },
        { kind: -2 },
        { unknown: true }
      ])
        expect(validate.validate({ slide: 1, dryRun: true, ...update }).ok).toBe(false);
      expect(validate.validate({ slide: 1, kind: 1 }).ok).toBe(false);
      expect(
        validate.validate({
          slide: 1,
          dryRun: true,
          site: 0,
          beginTarget: {
            fingerprint: "a".repeat(64),
            scope: "masters",
            owner: "/ppt/slideMasters/slideMaster1.xml",
            objectId: "2",
            coordinateSystem: "identity"
          }
        }).ok
      ).toBe(false);
    }
  }
  expect((await f.run(["connectors", "add", "/deck.pptx", "--slide", "1", "--dry-run"])).code).toBe(
    2
  );
  expect(f.reads()).toBe(0);
  for (const site of ["", " ", "0x1", "1e0"]) {
    const invalid = await f.run([
      "connectors",
      "set",
      "/deck.pptx",
      "--all",
      "--site",
      site,
      "--begin-target",
      JSON.stringify({
        fingerprint: "a".repeat(64),
        scope: "slides",
        owner: "/ppt/slides/slide1.xml",
        objectId: "2",
        coordinateSystem: "identity"
      }),
      "--dry-run"
    ]);
    expect(invalid.code).toBe(2);
  }
  expect(f.reads()).toBe(0);
});

it("creates, attaches, detaches and removes connectors through published command bytes", async () => {
  const f = await fixture();
  const target = (await readShapes(f.bytes(), {}, context))[0]!.location;
  const add = await f.run([
    "connectors",
    "add",
    "/deck.pptx",
    "--slide",
    "1",
    "--kind",
    "STRAIGHT",
    "--begin-x",
    "0emu",
    "--begin-y",
    "0emu",
    "--end-x",
    "100emu",
    "--end-y",
    "100emu",
    "--begin-target",
    JSON.stringify(target),
    "--site",
    "0",
    "--in-place"
  ]);
  expect(add.code, JSON.stringify(add.value)).toBe(0);
  expect(add.value.affected).toBe(1);
  const list = await f.run(["connectors", "list", "/deck.pptx"]);
  expect(list.code).toBe(0);
  expect(list.value.data.records).toHaveLength(1);
  const listSchema = (await f.run(["schema", "connectors", "list"])).value.data.operations[
    "connectors.list"
  ].result;
  expect(compileJsonSchema(listSchema).validate(list.value).ok).toBe(true);
  expect(
    compileJsonSchema(listSchema).validate({
      ...list.value,
      data: { records: [{ ...list.value.data.records[0], extra: true }] }
    }).ok
  ).toBe(false);
  const token = list.value.data.records[0].token;
  const style = await f.run([
    "connectors",
    "set",
    "/deck.pptx",
    "--select",
    token,
    "--name",
    "Flow",
    "--line-width",
    "1pt",
    "--line-color",
    "solid",
    "--in-place"
  ]);
  expect(style.code, JSON.stringify(style.value)).toBe(0);
  const styled = (await f.run(["connectors", "list", "/deck.pptx"])).value.data.records[0];
  expect([styled.name, styled.lineWidth]).toEqual(["Flow", 12700]);
  const detach = await f.run([
    "connectors",
    "set",
    "/deck.pptx",
    "--select",
    styled.token,
    "--begin-target",
    "null",
    "--in-place"
  ]);
  expect(detach.code, JSON.stringify(detach.value)).toBe(0);
  const refreshed = await f.run(["connectors", "list", "/deck.pptx"]);
  const removed = await f.run([
    "connectors",
    "remove",
    "/deck.pptx",
    "--select",
    refreshed.value.data.records[0].token,
    "--in-place"
  ]);
  expect(removed.code, JSON.stringify(removed.value)).toBe(0);
  expect(removed.value.affected).toBe(1);
  expect(removed.value.data.effects[0].action).toBe("remove");
  expect((await f.run(["connectors", "list", "/deck.pptx"])).value.data.records).toEqual([]);
});

it("requires explicit target deletion policy and detaches surviving connectors", async () => {
  const f = await fixture();
  const target = (await readShapes(f.bytes(), {}, context))[0]!;
  const result = await f.run([
    "connectors",
    "add",
    "/deck.pptx",
    "--slide",
    "1",
    "--kind",
    "CURVE",
    "--begin-x",
    "0emu",
    "--begin-y",
    "0emu",
    "--end-x",
    "100emu",
    "--end-y",
    "100emu",
    "--begin-target",
    JSON.stringify(target.location),
    "--site",
    "0",
    "--in-place"
  ]);
  expect(result.code).toBe(0);
  const original = f.bytes();
  const rejected = await f.run([
    "shapes",
    "remove",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    target.name,
    "--in-place"
  ]);
  expect(rejected.code, JSON.stringify(rejected.value)).toBe(1);
  expect(f.bytes()).toEqual(original);
  const removed = await f.run([
    "shapes",
    "remove",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    target.name,
    "--detach-policy",
    "detach",
    "--in-place"
  ]);
  expect(removed.code, JSON.stringify(removed.value)).toBe(0);
  expect(removed.value.data.effects[0].action).toBe("remove");
  const connectors = await f.run(["connectors", "list", "/deck.pptx"]);
  expect(connectors.value.data.records[0].beginTarget).toBeNull();
});
