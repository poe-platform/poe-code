import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { mutateSlides } from "./slides.js";
import { createPresentation } from "./creation.js";

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

describe("legacy comment commands", () => {
  it("creates explicit annotations, reads their identity, updates and removes", async () => {
    const f = await fixture();
    const added = await f.run([
      "comments",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--author",
      "River",
      "--timestamp",
      "2026-09-13T12:00:00Z",
      "--text",
      "Review 🐚",
      "--left",
      "2pt",
      "--top",
      "3pt",
      "--in-place"
    ]);
    expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
    expect(added.envelope.affected).toBe(1);
    const listed = await f.run(["comments", "list", "/deck.pptx"]);
    expect(listed.envelope.data.comments).toMatchObject([
      { slide: 1, author: "River", text: "Review 🐚", left: 25400, top: 38100 }
    ]);
    const record = listed.envelope.data.comments[0];
    const changed = await f.run([
      "comments",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--id",
      record.id,
      "--text",
      "Ready",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    const read = await f.run(["comments", "get", "/deck.pptx", "--slide", "1", "--id", record.id]);
    expect(read.envelope.data.comments[0].text).toBe("Ready");
    const removed = await f.run([
      "comments",
      "remove",
      "/deck.pptx",
      "--slide",
      "1",
      "--id",
      record.id,
      "--in-place"
    ]);
    expect(removed.exitCode, JSON.stringify(removed.envelope)).toBe(0);
    expect((await f.run(["comments", "list", "/deck.pptx"])).envelope.data.comments).toEqual([]);
  });
  it("requires comment cardinality and rejects stale owner selectors without publication", async () => {
    const f = await fixture();
    for (const text of ["One", "Two"])
      expect(
        (
          await f.run([
            "comments",
            "add",
            "/deck.pptx",
            "--slide",
            "1",
            "--author",
            "River",
            "--timestamp",
            "2026-09-13T12:00:00Z",
            "--text",
            text,
            "--in-place"
          ])
        ).exitCode
      ).toBe(0);
    const listed = await f.run(["comments", "list", "/deck.pptx"]);
    const record = listed.envelope.data.comments[0];
    const count = f.publishOutput.mock.calls.length;
    for (const action of ["get", "remove"]) {
      const result = await f.run([
        "comments",
        action,
        "/deck.pptx",
        "--slide",
        "1",
        ...(action === "remove" ? ["--in-place"] : [])
      ]);
      expect(result.envelope.errors[0].code).toBe("ambiguous-selection");
    }
    expect(f.publishOutput).toHaveBeenCalledTimes(count);
    expect(
      (
        await f.run([
          "comments",
          "set",
          "/deck.pptx",
          "--slide",
          "1",
          "--all",
          "--text",
          "Ready",
          "--in-place"
        ])
      ).envelope.affected
    ).toBe(2);
    const stale = await f.run([
      "comments",
      "remove",
      "/deck.pptx",
      "--select",
      record.selector,
      "--in-place"
    ]);
    expect(stale.envelope.errors[0].code).toBe("stale-selection");
    expect(f.publishOutput).toHaveBeenCalledTimes(count + 1);
  });
  it("uses an opaque comment selector to address one annotation among siblings", async () => {
    const f = await fixture();
    for (const text of ["First", "Second"])
      expect(
        (
          await f.run([
            "comments",
            "add",
            "/deck.pptx",
            "--slide",
            "1",
            "--author",
            "River",
            "--timestamp",
            "2026-09-13T12:00:00Z",
            "--text",
            text,
            "--in-place"
          ])
        ).exitCode
      ).toBe(0);
    const records = (await f.run(["comments", "list", "/deck.pptx"])).envelope.data.comments;
    const result = await f.run(["comments", "get", "/deck.pptx", "--select", records[1].selector]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
    expect(result.envelope.data.comments.map((record: { text: string }) => record.text)).toEqual([
      "Second"
    ]);
  });
  it("rounds explicit geometry to eighth-point positions", async () => {
    const f = await fixture();
    const added = await f.run([
      "comments",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--author",
      "River",
      "--timestamp",
      "2026-09-13T12:00:00Z",
      "--text",
      "Small offset",
      "--left",
      "0.125pt",
      "--top",
      "-1587.5emu",
      "--in-place"
    ]);
    expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
    const read = await f.run(["comments", "get", "/deck.pptx", "--slide", "1"]);
    expect(read.envelope.data.comments[0]).toMatchObject({ left: 1587.5, top: -1587.5 });
  });
  it("unfiltered get counts comments across slides instead of counting slide owners", async () => {
    const f = await fixture();
    const empty = await f.run(["comments", "get", "/deck.pptx"]);
    expect(empty.exitCode, JSON.stringify(empty.envelope)).toBe(0);
    expect(empty.envelope.data).toBeNull();
    for (const slide of ["2", "3"]) {
      const added = await f.run([
        "comments",
        "add",
        "/deck.pptx",
        "--slide",
        slide,
        "--author",
        "River",
        "--timestamp",
        "2026-09-13T12:00:00Z",
        "--text",
        "Slide " + slide,
        "--in-place"
      ]);
      expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
      const read = await f.run(["comments", "get", "/deck.pptx"]);
      if (slide === "2") {
        expect(read.exitCode, JSON.stringify(read.envelope)).toBe(0);
        expect(read.envelope.data.comments).toMatchObject([{ slide: 2, text: "Slide 2" }]);
      } else {
        expect(read.exitCode).toBe(1);
        expect(read.envelope.errors[0].code).toBe("ambiguous-selection");
      }
    }
  });
  it.each([
    [
      "add",
      "--id",
      "0:1",
      "--author",
      "River",
      "--text",
      "New",
      "--timestamp",
      "2026-09-13T12:00:00Z",
      "--dry-run"
    ],
    ["add", "--author", "River", "--text", "Missing clock", "--dry-run"],
    ["list", "--text", "Unexpected"],
    ["get", "--select", "opaque", "--id", "0:1"],
    ["set", "--dry-run"],
    ["remove", "--scope", "notes", "--dry-run"],
    ["add", "--author", "River", "--text", "Bad clock", "--timestamp", "yesterday", "--dry-run"]
  ])("rejects invalid options before input %j", async (action, ...flags) => {
    const f = await fixture();
    const result = await f.run(["comments", action!, "/deck.pptx", "--slide", "1", ...flags]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("declares schema and capabilities and supports preview without publication", async () => {
    const f = await fixture();
    const before = f.volume.readFileSync("/deck.pptx");
    const result = await f.run([
      "comments",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--author",
      "River",
      "--timestamp",
      "2026-09-13T12:00:00Z",
      "--text",
      "Preview",
      "--dry-run"
    ]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
    expect(f.volume.readFileSync("/deck.pptx")).toEqual(before);
    const schema = (await f.run(["schema", "comments", "add"])).envelope.data.operations[
      "comments.add"
    ];
    const validation = compileJsonSchema(schema.result).validate(result.envelope);
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    expect(
      compileJsonSchema(schema.options).validate({
        slide: 1,
        text: "",
        author: "River",
        timestamp: "2026-09-13T12:00:00Z",
        dryRun: true
      }).ok
    ).toBe(true);
    expect(
      compileJsonSchema(schema.options).validate({
        slide: 1,
        id: "0:1",
        text: "",
        author: "River",
        timestamp: "2026-09-13T12:00:00Z",
        dryRun: true
      }).ok
    ).toBe(false);
    expect(
      compileJsonSchema(schema.options).validate({
        slide: 1,
        text: "",
        author: "River",
        dryRun: true
      }).ok
    ).toBe(false);
  });
});
