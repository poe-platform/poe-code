import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { applyTemplateRepeat, type TemplateRepeat } from "./template-repeat.js";
import { readPresentationText } from "./text-reading.js";
import { inspectZip } from "../tests/zip-reader.js";
import { SaxesParser } from "saxes";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms?: number) =>
    ms === 0 ? queueMicrotask(cb) : timer(cb, ms)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const bind = (slide: number, text: string) => ({
  kind: "text" as const,
  name: "title",
  scope: "slides" as const,
  slide,
  cardinality: "one" as const,
  text
});
async function fixture() {
  const bytes = await createPresentation(
    {
      slides: ["Opening", "{{title}}", "Middle", "{{title}}", "Closing"].map((text) => ({
        shapes: [{ x: 0, y: 0, width: 100, height: 100, text }]
      }))
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/template.pptx", bytes);
  return new Uint8Array(volume.readFileSync("/template.pptx") as Buffer);
}
it.each([0, 1, 3])(
  "expands %i records in explicit prototype order with stable unaffected identities",
  async (count) => {
    const input = await fixture();
    const repeat: TemplateRepeat = {
      kind: "repeat",
      slides: [4, 2],
      mediaPolicy: "shared-media",
      records: Array.from({ length: count }, (_, i) => [bind(2, `A${i}`), bind(4, `B${i}`)])
    };
    const result = await applyTemplateRepeat(input, repeat, context);
    expect((await readPresentationText(result.bytes, {}, context)).text).toBe(
      [
        "Opening",
        ...Array.from({ length: count }, (_, i) => [`B${i}`, `A${i}`]).flat(),
        "Middle",
        "Closing"
      ].join("\n")
    );
    expect(await applyTemplateRepeat(input, repeat, context)).toEqual(result);
    const ids: string[] = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      if (tag.local === "sldId")
        ids.push(
          Object.values(tag.attributes).find((a) => a.local === "id" && a.uri === "")!.value
        );
    });
    parser
      .write(
        new TextDecoder().decode(
          inspectZip(result.bytes).find((p) => p.name === "ppt/presentation.xml")!.payload
        )
      )
      .close();
    expect(ids).toEqual([
      "256",
      ...Array.from({ length: count * 2 }, (_, i) => String(261 + i)),
      "258",
      "260"
    ]);
  }
);
it("rejects a later missing slot atomically and preserves source bytes", async () => {
  const input = await fixture(),
    before = input.slice();
  await expect(
    applyTemplateRepeat(
      input,
      {
        kind: "repeat",
        slides: [2],
        mediaPolicy: "shared-media",
        records: [[bind(2, "first")], [{ ...bind(2, "later"), name: "absent" }]]
      },
      context
    )
  ).rejects.toMatchObject({ code: "missing-binding" });
  expect(input).toEqual(before);
});
it("snapshots all records before asynchronous admission", async () => {
  const source = await fixture();
  const records = [[bind(2, "original")]];
  const slides = [2];
  const pending = applyTemplateRepeat(
    source,
    { kind: "repeat", slides, records, mediaPolicy: "shared-media" },
    context
  );
  records[0]![0]!.text = "changed";
  slides[0] = 4;
  expect((await readPresentationText((await pending).bytes, {}, context)).text).toBe(
    "Opening\noriginal\nMiddle\n{{title}}\nClosing"
  );
});
it("rejects accessors and aggregate payload overflow before input reads", async () => {
  const read = vi.fn(async () => null),
    getter = vi.fn(() => []);
  const repeat = {
    kind: "repeat",
    slides: [1],
    mediaPolicy: "shared-media",
    get records() {
      return getter();
    }
  };
  await expect(
    applyTemplateRepeat({ read }, repeat as TemplateRepeat, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(getter).not.toHaveBeenCalled();
  await expect(
    applyTemplateRepeat(
      { read },
      {
        kind: "repeat",
        slides: [1],
        mediaPolicy: "shared-media",
        records: [[bind(1, "海海")], [bind(1, "海海")]]
      },
      { ...context, limits: { ...context.limits, maxBytes: 10 } }
    )
  ).rejects.toMatchObject({ code: "resource-limit" });
  expect(read).not.toHaveBeenCalled();
});
it("does not invent an empty-record slot across paragraph boundaries", async () => {
  const source = await createPresentation(
    { slides: [{ shapes: [{ x: 0, y: 0, width: 100, height: 100, text: "{{title\n}}" }] }] },
    context
  );
  const result = await applyTemplateRepeat(
    source,
    { kind: "repeat", slides: [1], records: [[]], mediaPolicy: "shared-media" },
    context
  );
  expect((await readPresentationText(result.bytes, {}, context)).text).toBe("{{title\n}}");
});
it("requires bindings on every designated slide even when a record is empty", async () => {
  const input = await fixture();
  await expect(
    applyTemplateRepeat(
      input,
      { kind: "repeat", slides: [2], records: [[]], mediaPolicy: "shared-media" },
      context
    )
  ).rejects.toMatchObject({ code: "missing-binding" });
});
it.each([
  { slides: [1], records: Array.from({ length: 1001 }, () => []) },
  {
    slides: [1],
    records: [
      Array.from({ length: 501 }, (_, i) => ({ ...bind(1, "a"), name: `slot${i}` })),
      Array.from({ length: 500 }, (_, i) => ({ ...bind(1, "b"), name: `slot${i}` }))
    ]
  },
  { slides: [1, 2], records: Array.from({ length: 51 }, () => []) }
])(
  "bounds aggregate records, binding count and slide expansion before reads (%#)",
  async ({ slides, records }) => {
    const read = vi.fn(async () => null);
    await expect(
      applyTemplateRepeat(
        { read },
        { kind: "repeat", mediaPolicy: "shared-media", slides, records },
        context
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(read).not.toHaveBeenCalled();
  }
);
it.each([
  { slides: [1, 1] },
  { slides: [0] },
  { slides: [] },
  { mediaPolicy: "automatic" },
  { records: [[bind(2, "wrong")]] },
  { records: Object.assign([], { extra: true }) },
  { records: [Object.create(Array.prototype)] },
  { extra: true }
])("rejects noncanonical repeat structures before reads (%#)", async (patch) => {
  const read = vi.fn(async () => null);
  await expect(
    applyTemplateRepeat(
      { read },
      {
        kind: "repeat",
        slides: [1],
        records: [],
        mediaPolicy: "shared-media",
        ...patch
      } as TemplateRepeat,
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(read).not.toHaveBeenCalled();
});
it("counts media bytes across records before input admission", async () => {
  const read = vi.fn(async () => null);
  const image = {
    kind: "image" as const,
    name: "badge",
    slide: 1,
    scope: "slides" as const,
    cardinality: "one" as const,
    image: { bytes: [1, 2, 3, 4, 5, 6], contentType: "image/gif" }
  };
  await expect(
    applyTemplateRepeat(
      { read },
      {
        kind: "repeat",
        slides: [1],
        mediaPolicy: "isolated-instance",
        records: [[image], [image]]
      },
      { ...context, limits: { ...context.limits, maxBytes: 10 } }
    )
  ).rejects.toMatchObject({ code: "resource-limit" });
  expect(read).not.toHaveBeenCalled();
});
