import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation, addMedia, readMedia } from "./index.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
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
const bytes = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
const poster = {
  bytes: new Uint8Array([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 2, 2, 68, 1, 0, 59
  ]),
  contentType: "image/gif"
};
const options = {
  slide: 1,
  bytes,
  poster,
  contentType: "video/mp4",
  kind: "video" as const,
  left: 123,
  top: 456,
  width: 789,
  height: 321
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function fixture(occupied: readonly number[] = [], timing = "") {
  const source = await createPresentation({ slides: [{}] }, context);
  const entries: { name: string; bytes: Uint8Array }[] = inspectZip(source).map(
    ({ name, payload }) => ({ name, bytes: payload })
  );
  const slide = entries.find((x) => x.name === "ppt/slides/slide1.xml")!;
  if (timing) {
    const doc = parseXmlPart(slide.bytes, context.xmlLimits);
    slide.bytes = doc.spliceChildren(doc.root, doc.root.children.length, 0, [timing]).bytes();
  }
  const types = entries.find((x) => x.name === "[Content_Types].xml")!;
  const doc = parseXmlPart(types.bytes, context.xmlLimits);
  types.bytes = doc
    .spliceChildren(
      doc.root,
      doc.root.children.length,
      0,
      occupied.map(
        (i) =>
          `<Override xmlns="${doc.root.name.namespace}" PartName="/ppt/media/clip${i}.mp4" ContentType="video/mp4"/>`
      )
    )
    .bytes();
  for (const i of occupied)
    entries.push({
      name: `ppt/media/clip${i}.mp4`,
      bytes: new Uint8Array([...bytes.slice(0, -1), i])
    });
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", storedArchive(entries));
  return new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
}
it.each([
  { occupied: [3, 4, 2], next: 1 },
  { occupied: [4, 2, 1], next: 3 },
  { occupied: [2, 3, 1], next: 4 }
])("allocates first unoccupied clip index for $occupied", async ({ occupied, next }) => {
  const result = await addMedia(await fixture(occupied), options, context);
  const inventory = await readMedia(result, {}, context);
  expect(inventory.occurrences[0]!.relationships.map((x) => x.mediaPart)).toEqual([
    `/ppt/media/clip${next}.mp4`,
    `/ppt/media/clip${next}.mp4`
  ]);
  for (const i of occupied)
    expect(
      inspectZip(result)
        .find((x) => x.name === `ppt/media/clip${i}.mp4`)!
        .payload.at(-1)
    ).toBe(i);
});
it.each([false, true])(
  "retains supplied geometry and poster after insertion with existing clip %s",
  async (existing) => {
    let source: Uint8Array = await fixture();
    if (existing) source = await addMedia(source, options, context);
    const output = await addMedia(source, options, context);
    const inventory = await readMedia(output, {}, context);
    expect(inventory.occurrences).toHaveLength(existing ? 2 : 1);
    const xml = new TextDecoder().decode(
      inspectZip(output).find((x) => x.name === "ppt/slides/slide1.xml")!.payload
    );
    expect(xml).toContain('x="123" y="456"');
    expect(xml).toContain('cx="789" cy="321"');
    const occurrence = inventory.occurrences.at(-1)!;
    expect(occurrence.posters).toHaveLength(1);
    expect(
      inspectZip(output).some(
        (x) =>
          x.payload.length === poster.bytes.length &&
          x.payload.every((v, i) => v === poster.bytes[i])
      )
    ).toBe(true);
  }
);
it.each([false, true])("reuses equal media bytes only on identity hit %s", async (equal) => {
  const source = await addMedia(await fixture(), options, context);
  const replacement = bytes.slice();
  if (!equal) replacement[15] = 9;
  const output = await addMedia(source, { ...options, bytes: replacement }, context);
  const inventory = await readMedia(output, {}, context);
  const first = inventory.occurrences[0]!.relationships[0]!.mediaPart;
  const second = inventory.occurrences[1]!.relationships[0]!.mediaPart;
  expect(second === first).toBe(equal);
  expect(inventory.occurrences[0]!.relationships[0]!.relationshipId).not.toBe(
    inventory.occurrences[1]!.relationships[0]!.relationshipId
  );
});
it.each([
  "",
  '<p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:tnLst><p:par><p:cTn id="9"/></p:par></p:tnLst></p:timing>',
  '<p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:extLst><p:ext uri="retained"/></p:extLst></p:timing>'
])("adds inert timing without deleting existing timing variant %s", async (timing) => {
  const output = await addMedia(await fixture([], timing), options, context);
  const xml = new TextDecoder().decode(
    inspectZip(output).find((x) => x.name === "ppt/slides/slide1.xml")!.payload
  );
  expect(xml).toContain('delay="indefinite"');
  if (timing.includes('id="9"')) expect(xml).toContain('id="9"');
  if (timing.includes('uri="retained"')) expect(xml).toContain('uri="retained"');
  expect((await readMedia(output, {}, context)).occurrences[0]!.timing.length).toBeGreaterThan(0);
});
