import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { mutateSlides } from "./slides.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";

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
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 262144
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
let original: Promise<Uint8Array> | undefined;
async function fixture() {
  original ??= (async () =>
    await mutateSlides(
      await createPresentation(
        { slides: [{ name: "One" }, { name: "Two" }, { name: "Three" }] },
        context
      ),
      { selection: { kind: "slide", id: "257" }, hidden: true },
      context
    ))();
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", await original);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (publication: PptxPublicationRequest) => {
    if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
  });
  return {
    volume,
    readInput,
    publishOutput,
    async run(args: string[]) {
      const result = await engine.execute({
        args: [...args, "--json"].map((value) => new TextEncoder().encode(value)),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      });
      return { ...result, envelope: JSON.parse(decode(result.stdout)) };
    }
  };
}

describe("section and show commands", () => {
  it.each(["sections", "shows"])(
    "creates, discovers, renames and removes %s with reusable identities",
    async (kind) => {
      const f = await fixture();
      const added = await f.run([
        kind,
        "add",
        "/deck.pptx",
        "--name",
        "",
        "--slides",
        "[1,2]",
        "--in-place"
      ]);
      expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
      expect(added.envelope).toMatchObject({ operation: `${kind}.add`, affected: 1 });
      const listed = await f.run([kind, "list", "/deck.pptx"]);
      expect(listed.exitCode).toBe(0);
      expect(listed.envelope.data.records).toMatchObject([
        { name: "", slides: [1, 2], position: 1 }
      ]);
      const record = listed.envelope.data.records[0];
      const renamed = await f.run([
        kind,
        "set",
        "/deck.pptx",
        "--select",
        record.token,
        "--name",
        "Field notes",
        "--in-place"
      ]);
      expect(renamed.exitCode, JSON.stringify(renamed.envelope)).toBe(0);
      const fetched = await f.run([kind, "get", "/deck.pptx", "--slide", "2"]);
      expect(fetched.envelope.data.records).toMatchObject([
        { id: record.id, name: "Field notes", slides: [1, 2] }
      ]);
      const removed = await f.run([
        kind,
        "remove",
        "/deck.pptx",
        "--select",
        fetched.envelope.data.records[0].token,
        "--in-place"
      ]);
      expect(removed.exitCode).toBe(0);
      expect((await f.run([kind, "list", "/deck.pptx"])).envelope.data.records).toEqual([]);
      const xml = decode(
        inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).find(
          (entry) => entry.name === "ppt/slides/slide2.xml"
        )!.payload
      );
      expect(xml).toContain('show="0"');
    }
  );
  it("reorders shows with stable IDs and schema-valid mutation reports", async () => {
    const f = await fixture();
    for (const name of ["First", "Second"])
      expect(
        (
          await f.run([
            "shows",
            "add",
            "/deck.pptx",
            "--name",
            name,
            "--slides",
            "[1]",
            "--in-place"
          ])
        ).exitCode
      ).toBe(0);
    const before = (await f.run(["shows", "list", "/deck.pptx"])).envelope.data.records;
    const moved = await f.run([
      "shows",
      "set",
      "/deck.pptx",
      "--select",
      before[1].token,
      "--position",
      "1",
      "--in-place"
    ]);
    expect(moved.exitCode).toBe(0);
    const records = (await f.run(["shows", "list", "/deck.pptx"])).envelope.data.records;
    expect(records.map((record: { id: string }) => record.id)).toEqual([
      before[1].id,
      before[0].id
    ]);
    const schema = (await f.run(["schema", "shows", "set"])).envelope.data.operations["shows.set"];
    expect(compileJsonSchema(schema.result).validate(moved.envelope).ok).toBe(true);
    expect(compileJsonSchema(schema.options).validate({ position: 1, dryRun: true }).ok).toBe(true);
  });
  it("preserves whole-show order when moving every show to the first position", async () => {
    const f = await fixture();
    for (const name of ["A", "B", "C"])
      await f.run(["shows", "add", "/deck.pptx", "--name", name, "--slides", "[1]", "--in-place"]);
    const moved = await f.run([
      "shows",
      "set",
      "/deck.pptx",
      "--all",
      "--position",
      "1",
      "--in-place"
    ]);
    expect(moved.exitCode).toBe(0);
    const listed = await f.run(["shows", "list", "/deck.pptx"]);
    expect(listed.envelope.data.records.map((record: { name: string }) => record.name)).toEqual([
      "A",
      "B",
      "C"
    ]);
  });
  it("expands a section around an inserted duplicate while retaining show members", async () => {
    const f = await fixture();
    await f.run([
      "sections",
      "add",
      "/deck.pptx",
      "--name",
      "Opening",
      "--slides",
      "[1,2]",
      "--in-place"
    ]);
    await f.run([
      "shows",
      "add",
      "/deck.pptx",
      "--name",
      "Route",
      "--slides",
      "[2,1]",
      "--in-place"
    ]);
    const duplicated = await f.run([
      "slides",
      "duplicate",
      "/deck.pptx",
      "--slide",
      "1",
      "--position",
      "2",
      "--in-place"
    ]);
    expect(duplicated.exitCode, JSON.stringify(duplicated.envelope)).toBe(0);
    expect(
      (await f.run(["sections", "list", "/deck.pptx"])).envelope.data.records[0].slides
    ).toEqual([1, 2, 3]);
    expect((await f.run(["shows", "list", "/deck.pptx"])).envelope.data.records[0].slides).toEqual([
      3, 1
    ]);
  });
  it("rejects ambiguous show selection and stale tokens before publication", async () => {
    const f = await fixture();
    for (const slides of ["[1]", "[2]"])
      expect(
        (
          await f.run([
            "shows",
            "add",
            "/deck.pptx",
            "--name",
            "Shared",
            "--slides",
            slides,
            "--in-place"
          ])
        ).exitCode
      ).toBe(0);
    const list = await f.run(["shows", "list", "/deck.pptx"]);
    expect((await f.run(["shows", "get", "/deck.pptx"])).envelope.errors[0].code).toBe(
      "ambiguous-selection"
    );
    expect(
      (await f.run(["shows", "set", "/deck.pptx", "--name", "Renamed", "--all", "--in-place"]))
        .exitCode
    ).toBe(0);
    const count = f.publishOutput.mock.calls.length;
    expect(
      (
        await f.run([
          "shows",
          "remove",
          "/deck.pptx",
          "--select",
          list.envelope.data.records[0].token,
          "--in-place"
        ])
      ).envelope.errors[0].code
    ).toBe("stale-selection");
    expect(f.publishOutput).toHaveBeenCalledTimes(count);
  });
  it.each([
    ["sections", "add", "--name", "A", "--slides", "[]", "--dry-run"],
    ["shows", "add", "--name", "A", "--slides", "[1,1]", "--dry-run"],
    ["shows", "add", "--slides", "[1]", "--dry-run"],
    ["sections", "set", "--dry-run"],
    ["shows", "set", "--position", "0", "--dry-run"],
    ["sections", "list", "--in-place"],
    ["sections", "list", "--scope", "notes"]
  ])("rejects invalid membership arguments before input %j", async (kind, action, ...flags) => {
    const f = await fixture();
    const result = await f.run([kind!, action!, "/deck.pptx", ...flags]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("reports singular membership effects and documents membership cleanup", async () => {
    const f = await fixture();
    const request = { signal: new AbortController().signal, readInput: f.readInput };
    const result = await engine.execute({
      ...request,
      args: ["shows", "add", "/deck.pptx", "--name", "Trail", "--slides", "[1]", "--dry-run"].map(
        (x) => new TextEncoder().encode(x)
      )
    });
    expect(result.exitCode).toBe(0);
    expect(decode(result.stdout)).toBe("Validated 1 show\n");
    const help = await engine.execute({ ...request, args: [new TextEncoder().encode("--help")] });
    expect(decode(help.stdout)).toContain(
      "Section/show memberships are pruned automatically on slide removal."
    );
    expect(decode(help.stdout)).toContain("pptx schema sections|shows list|get|add|set|remove");
  });
  it.each(["sections", "shows"])("publishes discoverable %s schemas", async (kind) => {
    const f = await fixture();
    for (const action of ["list", "get", "add", "set", "remove"]) {
      const result = await f.run(["schema", kind, action]);
      expect(result.exitCode).toBe(0);
      const schema = result.envelope.data.operations[`${kind}.${action}`];
      expect(schema).toBeDefined();
      const options = compileJsonSchema(schema.options);
      if (action === "add")
        expect(options.validate({ name: "Route", slides: [1], output: "-", json: true }).ok).toBe(
          false
        );
      expect(
        options.validate(
          action === "add"
            ? { name: "", slides: [1], dryRun: true }
            : action === "set"
              ? { name: "", dryRun: true }
              : action === "remove"
                ? { dryRun: true }
                : {}
        ).ok
      ).toBe(true);
    }
    const capabilities = await f.run(["capabilities"]);
    expect(capabilities.envelope.data.features[kind].level).toBe("edit");
  });
});
