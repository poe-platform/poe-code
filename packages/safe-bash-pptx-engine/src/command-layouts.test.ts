import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
let original: Promise<Uint8Array> | undefined;
async function fixture() {
  original ??= createPresentation(
    {
      slides: [
        { shapes: [{ x: 100, y: 200, width: 300, height: 400, text: "Canvas stays independent" }] }
      ]
    },
    context
  );
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
      return { ...result, envelope: JSON.parse(new TextDecoder().decode(result.stdout)) };
    }
  };
}

describe("layout commands", () => {
  it("lists stable layout metadata and declares every supported route", async () => {
    const f = await fixture();
    const listed = await f.run(["layouts", "list", "/deck.pptx"]);
    expect(listed.exitCode).toBe(0);
    expect(listed.envelope.data.records).toMatchObject([
      { part: "/ppt/slideLayouts/slideLayout1.xml", affectedSlides: [1] }
    ]);
    for (const action of ["list", "get", "add", "set", "remove", "apply"]) {
      const schema = await f.run(["schema", "layouts", action]);
      expect(schema.exitCode).toBe(0);
      expect(schema.envelope.data.operations[`layouts.${action}`]).toBeDefined();
      if (action === "list")
        expect(
          compileJsonSchema(schema.envelope.data.operations["layouts.list"].result).validate(
            listed.envelope
          ).ok
        ).toBe(true);
    }
  });
  it("creates, renames, applies and removes layouts without changing local slide bytes", async () => {
    const f = await fixture();
    const added = await f.run([
      "layouts",
      "add",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--name",
      "Harbor",
      "--master",
      "/ppt/slideMasters/slideMaster1.xml",
      "--in-place"
    ]);
    expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
    const part = added.envelope.data.part;
    const renamed = await f.run([
      "layouts",
      "set",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--part",
      part,
      "--name",
      "Coast",
      "--in-place"
    ]);
    expect(renamed.exitCode, JSON.stringify(renamed.envelope)).toBe(0);
    const before = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).find(
      (e) => e.name === "ppt/slides/slide1.xml"
    )!.payload;
    const applied = await f.run([
      "layouts",
      "apply",
      "/deck.pptx",
      "--slide",
      "1",
      "--layout",
      "Coast",
      "--placeholder-policy",
      "type-index",
      "--in-place"
    ]);
    expect(applied.exitCode, JSON.stringify(applied.envelope)).toBe(0);
    expect(applied.envelope).toMatchObject({ affected: 1, data: { affectedSlides: [1] } });
    expect(
      inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).find(
        (e) => e.name === "ppt/slides/slide1.xml"
      )!.payload
    ).toEqual(before);
    const removed = await f.run([
      "layouts",
      "remove",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--part",
      "/ppt/slideLayouts/slideLayout1.xml",
      "--in-place"
    ]);
    expect(removed.exitCode, JSON.stringify(removed.envelope)).toBe(0);
    expect(removed.envelope.affected).toBe(1);
    const blocked = await f.run([
      "layouts",
      "remove",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--part",
      part,
      "--in-place"
    ]);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.envelope.affected).toBe(0);
  });
  it("sets declared layout properties and selected text with closed schemas", async () => {
    const f = await fixture();
    const created = await f.run([
      "layouts",
      "add",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--name",
      "Field",
      "--master",
      "/ppt/slideMasters/slideMaster1.xml",
      "--type",
      "title",
      "--preserve",
      "true",
      "--show-master-shapes",
      "false",
      "--matching-name",
      "Field match",
      "--placeholders-json",
      JSON.stringify([
        {
          type: "title",
          index: 7,
          name: "Heading",
          text: "Original",
          x: 10,
          y: 20,
          width: 300,
          height: 400
        }
      ]),
      "--in-place"
    ]);
    expect(created.exitCode, JSON.stringify(created.envelope)).toBe(0);
    const part = created.envelope.data.part;
    const listed = await f.run(["layouts", "get", "/deck.pptx", "--part", part]);
    expect(listed.envelope.data.records).toMatchObject([
      {
        name: "Field",
        type: "title",
        preserve: true,
        showMasterShapes: false,
        matchingName: "Field match",
        placeholders: [{ type: "title", index: 7, x: 10, y: 20, width: 300, height: 400 }]
      }
    ]);
    const oldToken = listed.envelope.locations[0];
    expect(oldToken.scope).toBe("layouts");
    const edited = await f.run([
      "layouts",
      "set",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--part",
      part,
      "--shape",
      "Heading",
      "--text",
      "Updated",
      "--in-place"
    ]);
    expect(edited.exitCode, JSON.stringify(edited.envelope)).toBe(0);
    expect(edited.envelope.affected).toBe(1);
    const entry = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).find(
      (e) => "/" + e.name === part
    )!;
    expect(new TextDecoder().decode(entry.payload)).toContain(">Updated<");
    expect(new TextDecoder().decode(entry.payload)).not.toContain(">Original<");
    for (const [action, envelope] of [
      ["add", created.envelope],
      ["get", listed.envelope],
      ["set", edited.envelope]
    ] as const) {
      const schema = await f.run(["schema", "layouts", action]);
      expect(
        compileJsonSchema(schema.envelope.data.operations[`layouts.${action}`].result).validate(
          envelope
        ).ok
      ).toBe(true);
    }
  });
  it("clears matching names through the same explicit empty value as the SDK", async () => {
    const f = await fixture();
    const result = await f.run([
      "layouts",
      "set",
      "/deck.pptx",
      "--scope",
      "layouts",
      "--slide",
      "1",
      "--matching-name",
      "",
      "--in-place"
    ]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
  });
  it("requires selected mutation intent in generated option schemas", async () => {
    const f = await fixture();
    for (const action of ["set", "remove", "apply"]) {
      const schema = await f.run(["schema", "layouts", action]);
      const validate = compileJsonSchema(
        schema.envelope.data.operations[`layouts.${action}`].options
      ).validate;
      const options =
        action === "apply"
          ? { layout: "Blank", placeholderPolicy: "type-index", dryRun: true }
          : { scope: "layouts", ...(action === "set" ? { name: "Changed" } : {}), dryRun: true };
      expect(validate(options).ok).toBe(false);
      expect(validate({ ...options, slide: 1 }).ok).toBe(true);
      expect(validate({ ...options, all: false }).ok).toBe(false);
    }
  });
  it.each([
    ["apply", "--slide", "1", "--layout", "Blank"],
    ["apply", "--layout", "Blank", "--placeholder-policy", "type-index"],
    ["set", "--part", "/ppt/slideLayouts/slideLayout1.xml", "--name", "Changed"],
    ["remove", "--scope", "layouts"],
    ["apply", "--slide", "1", "--layout", "Blank", "--placeholder-policy", "unknown"]
  ])("rejects incomplete intent before reading: %s", async (...args) => {
    const f = await fixture();
    const result = await f.run(["layouts", ...args, "/deck.pptx", "--dry-run"]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
});
