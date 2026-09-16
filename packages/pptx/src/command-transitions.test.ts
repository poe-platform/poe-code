import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { compileJsonSchema } from "toolcraft-schema";
import { readTransitions, mutateTransitions } from "./transitions.js";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});

it.each(["cut", "fade", "push", "wipe"] as const)(
  "round trips %s timing through command and SDK",
  async (kind) => {
    const f = await fixture();
    const direction = kind === "push" || kind === "wipe" ? ["--direction", "left"] : [];
    const added = await f.run([
      "transitions",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      kind,
      ...direction,
      "--duration",
      kind === "cut" ? "0" : "1251",
      "--advance-after",
      "0",
      "--advance-on-click",
      "false",
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(added.exitCode, decode(added.stdout)).toBe(0);
    const bytes = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
    expect(await readTransitions(bytes, {}, context)).toMatchObject([
      { kind, duration: kind === "cut" ? 0 : 1251, advanceAfter: 0, advanceOnClick: false }
    ]);
    const changed = await mutateTransitions(
      bytes,
      "set",
      { selection: { kind: "slide", all: true }, advanceAfter: null, advanceOnClick: true },
      context
    );
    f.volume.writeFileSync("/changed.pptx", changed.bytes);
    for (const action of ["get", "list"]) {
      const out = await f.run(["transitions", action, "/changed.pptx", "--slide", "1", "--json"]);
      const envelope = JSON.parse(decode(out.stdout));
      expect(envelope.data.items[0].fields).toEqual([
        {
          name: "direction",
          value: {
            type: direction.length ? "string" : "null",
            value: direction.length ? "left" : null
          }
        },
        { name: "duration", value: { type: "number", value: kind === "cut" ? 0 : 1251 } },
        { name: "advanceAfter", value: { type: "null", value: null } },
        { name: "advanceOnClick", value: { type: "boolean", value: true } }
      ]);
      const schema = JSON.parse(
        decode((await f.run(["schema", "transitions", action, "--json"])).stdout)
      ).data.operations[`transitions.${action}`];
      expect(compileJsonSchema(schema.result).validate(envelope).ok).toBe(true);
    }
    for (const action of ["set", "remove"]) {
      const out = await f.run([
        "transitions",
        action,
        "/changed.pptx",
        "--slide",
        "1",
        ...(action === "set" ? ["--advance-after", "null"] : []),
        "--in-place",
        "--json"
      ]);
      expect(out.exitCode, decode(out.stdout)).toBe(0);
      const schema = JSON.parse(
        decode((await f.run(["schema", "transitions", action, "--json"])).stdout)
      ).data.operations[`transitions.${action}`];
      expect(
        compileJsonSchema(schema.result).validate(JSON.parse(decode(out.stdout)))
      ).toMatchObject({ ok: true });
    }
    const schema = JSON.parse(
      decode((await f.run(["schema", "transitions", "add", "--json"])).stdout)
    ).data.operations["transitions.add"];
    expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(added.stdout))).ok).toBe(
      true
    );
    const empty = await f.run(["transitions", "get", "/changed.pptx", "--slide", "1", "--json"]);
    expect(empty.exitCode).toBe(0);
    expect(JSON.parse(decode(empty.stdout)).data.items).toEqual([]);
  }
);

it.each([
  ["--kind", "fade", "--direction", "up"],
  ["--kind", "push"],
  ["--kind", "cut", "--duration", "1"],
  ["--kind", "fade", "--duration", "1.5"],
  ["--kind", "fade", "--duration", "2s"],
  ["--kind", "fade", "--duration", "-1"],
  ["--kind", "fade", "--duration", "2147483648"],
  ["--kind", "fade", "--advance-on-click", "0"],
  ["--kind", "fade", "--advance-on-click", "false", "--advance-on-click", "true"],
  ["--kind", "fade", "--shape", "Caption"],
  ["--kind", "fade", "--scope", "notes"]
])("rejects conflicting or inapplicable transition settings before reading", async (...flags) => {
  const f = await fixture();
  const result = await f.run([
    "transitions",
    "add",
    "/deck.pptx",
    "--slide",
    "1",
    "--dry-run",
    "--json",
    ...flags
  ]);
  expect(result.exitCode, decode(result.stdout)).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
  expect(f.publishOutput).not.toHaveBeenCalled();
});

it("enforces closed schema options and advertises capabilities", async () => {
  const f = await fixture();
  const schema = JSON.parse(
    decode((await f.run(["schema", "transitions", "add", "--json"])).stdout)
  ).data.operations["transitions.add"];
  const validator = compileJsonSchema(schema.options);
  expect(
    validator.validate({
      kind: "fade",
      slide: 1,
      dryRun: true,
      advanceAfter: null,
      advanceOnClick: false
    }).ok
  ).toBe(true);
  for (const options of [
    { kind: "cut", duration: 1 },
    { kind: "push" },
    { kind: "fade", direction: "up" },
    { kind: "fade", duration: 0.5 },
    { kind: "fade", shape: "Caption" }
  ])
    expect(validator.validate({ slide: 1, dryRun: true, ...options }).ok).toBe(false);
  const help = decode((await f.run(["transitions", "add", "--help"])).stdout);
  expect(help.split("\n").every((line) => line.length <= 80)).toBe(true);
  expect(decode((await f.run(["capabilities", "--json"])).stdout)).toContain(
    '"transitions.remove"'
  );
});
afterAll(() => vi.restoreAllMocks());
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
  validationLimits: {
    maxBytes: 8192,
    maxNodes: 1000,
    maxDepth: 32,
    maxParts: 32,
    maxRelationships: 64,
    maxEntries: 32
  }
};
async function fixture() {
  const bytes = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "雪 café 雪" }] }
      ]
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", bytes);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (publication: PptxPublicationRequest) => {
    if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  return {
    volume,
    bytes,
    readInput,
    publishOutput,
    run: (args: string[]) =>
      engine.execute({
        args: args.map(encode),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      })
  };
}

describe("transition command discovery", () => {
  it("advertises integer timing and explicit click controls", async () => {
    const f = await fixture();
    const result = await f.run(["transitions", "set", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stdout)).toContain("--advance-on-click true|false");
  });
});

it("lists every slide transition with omitted filters and returns an empty collection", async () => {
  const f = await fixture();
  const deck = await createPresentation({ slides: [{}, {}] }, context);
  const changed = await mutateTransitions(
    deck,
    "set",
    { selection: { kind: "slide", all: true }, kind: "fade" },
    context
  );
  f.volume.writeFileSync("/deck.pptx", changed.bytes);
  for (const scope of [[], ["--scope", "slides"]]) {
    const out = await f.run(["transitions", "list", "/deck.pptx", ...scope, "--json"]);
    expect(out.exitCode, decode(out.stdout)).toBe(0);
    expect(
      JSON.parse(decode(out.stdout)).data.items.map((item: { kind: string }) => item.kind)
    ).toEqual(["fade", "fade"]);
  }
  f.volume.writeFileSync("/deck.pptx", await createPresentation({ slides: [] }, context));
  const empty = await f.run(["transitions", "list", "/deck.pptx", "--json"]);
  expect(empty.exitCode, decode(empty.stdout)).toBe(0);
  expect(JSON.parse(decode(empty.stdout)).data.items).toEqual([]);
});

it("accepts a token with explicit all without widening its owner", async () => {
  const f = await fixture();
  const deck = await createPresentation({ slides: [{}, {}] }, context);
  f.volume.writeFileSync("/deck.pptx", deck);
  const records = await readTransitions(deck, {}, context);
  const out = await f.run([
    "transitions",
    "set",
    "/deck.pptx",
    "--select",
    records[1]!.selector,
    "--all",
    "--kind",
    "fade",
    "--in-place",
    "--json"
  ]);
  expect(out.exitCode, decode(out.stdout)).toBe(0);
  expect(JSON.parse(decode(out.stdout)).affected).toBe(1);
  const after = await readTransitions(
    new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer),
    {},
    context
  );
  expect(after.map((record) => record.kind)).toEqual([null, "fade"]);
});

it("allows an explicitly empty mutation without publication and rejects ambiguous owners", async () => {
  const f = await fixture();
  for (const action of ["set", "remove"]) {
    const out = await f.run([
      "transitions",
      action,
      "/deck.pptx",
      "--slide",
      "99",
      "--allow-empty",
      "--dry-run",
      "--json",
      ...(action === "set" ? ["--advance-on-click", "false"] : [])
    ]);
    expect(out.exitCode, decode(out.stdout)).toBe(0);
    expect(JSON.parse(decode(out.stdout)).data).toEqual({
      effects: [],
      outputs: [],
      fingerprint: null
    });
  }
  expect(f.publishOutput).not.toHaveBeenCalled();
  f.volume.writeFileSync("/deck.pptx", await createPresentation({ slides: [{}, {}] }, context));
  expect((await f.run(["transitions", "get", "/deck.pptx", "--json"])).exitCode).toBe(1);
  expect(
    (
      await f.run([
        "transitions",
        "add",
        "/deck.pptx",
        "--all",
        "--kind",
        "fade",
        "--dry-run",
        "--json"
      ])
    ).exitCode
  ).toBe(1);
});
