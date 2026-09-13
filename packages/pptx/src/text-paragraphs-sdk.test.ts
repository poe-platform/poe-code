import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, mutateTextParagraphs, readTextParagraphs } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
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

it("round trips paragraph overrides with tabs through a memory volume preserving master defaults", async () => {
  const volume = Volume.fromJSON({});
  const source = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Note", x: 0, y: 0, width: 200, height: 100, text: "River\nForest" }] }
      ]
    },
    context
  );
  volume.writeFileSync("/source.pptx", source);
  const result = await mutateTextParagraphs(
    new Uint8Array(volume.readFileSync("/source.pptx") as Buffer),
    {
      paragraph: 0,
      alignment: "right",
      marginLeft: 0,
      indent: -6,
      spaceBefore: 0,
      spaceAfter: 12,
      rtl: true,
      level: 2,
      bullet: { kind: "numbered", scheme: "hebrew2Minus", startAt: 3 },
      tabs: [
        { position: 0, alignment: "left" },
        { position: 36, alignment: "decimal" }
      ]
    },
    context
  );
  volume.writeFileSync("/result.pptx", result.bytes);
  const raw = new TextDecoder().decode(
    inspectZip(result.bytes).find((e) => e.name === "ppt/slides/slide1.xml")!.payload
  );
  for (const fragment of [
    'marL="0"',
    'indent="-76200"',
    'type="hebrew2Minus"',
    'startAt="3"',
    'pos="457200"',
    'algn="dec"'
  ])
    expect(raw).toContain(fragment);
  expect(result.affected).toBe(1);
  const read = await readTextParagraphs(
    new Uint8Array(volume.readFileSync("/result.pptx") as Buffer),
    {},
    context
  );
  expect(read[0]?.formatting).toMatchObject({
    marginLeft: 0,
    indent: -6,
    spaceBefore: 0,
    spaceAfter: 12,
    level: 2,
    rtl: true,
    tabs: [
      { position: 0, alignment: "left" },
      { position: 36, alignment: "decimal" }
    ]
  });
  expect(read[1]?.formatting).toMatchObject({
    marginLeft: null,
    level: null,
    rtl: null,
    tabs: null
  });
  const cleared = await mutateTextParagraphs(
    result.bytes,
    { paragraph: 0, marginLeft: null, bullet: null, tabs: null },
    context
  );
  expect((await readTextParagraphs(cleared.bytes, {}, context))[0]?.formatting).toMatchObject({
    marginLeft: null,
    bullet: null,
    tabs: null,
    rtl: true
  });
  for (const entry of inspectZip(source).filter((e) => e.name !== "ppt/slides/slide1.xml"))
    expect(inspectZip(cleared.bytes).find((e) => e.name === entry.name)?.payload).toEqual(
      entry.payload
    );
});
it("distinguishes explicit empty tab list from inherited tab stops", async () => {
  const source = await createPresentation(
    { slides: [{ shapes: [{ name: "Note", x: 0, y: 0, width: 20, height: 20, text: "Seed" }] }] },
    context
  );
  const changed = await mutateTextParagraphs(source, { paragraph: 0, tabs: [] }, context);
  expect((await readTextParagraphs(changed.bytes, {}, context))[0]?.formatting.tabs).toEqual([]);
});
