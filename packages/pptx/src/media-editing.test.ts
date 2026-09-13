import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addMedia, replaceMedia } from "./media-editing.js";
import { readMedia } from "./media.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
import { attr } from "./masters.js";
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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const clip = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
const poster = {
  bytes: new Uint8Array([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 2, 2, 68, 1, 0, 59
  ]),
  contentType: "image/gif"
};
const options = {
  slide: 1,
  bytes: clip,
  contentType: "video/mp4",
  kind: "video" as const,
  poster,
  left: 0,
  top: 0,
  width: 914400,
  height: 914400
};
function parts(bytes: Uint8Array) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/out.pptx", bytes);
  return new Map<string, Uint8Array>(
    inspectZip(new Uint8Array(fs.readFileSync("/out.pptx") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
}
it("inserts explicit movie bytes with distinct complete clip and poster relationships and inert timing", async () => {
  const source = await createPresentation({ slides: [{}] }, context);
  const output = await addMedia(
    source,
    { ...options, trimStart: 100, trimEnd: 200, loop: true, volume: 45000 },
    context
  );
  const files = parts(output);
  const xml = new TextDecoder().decode(files.get("ppt/slides/slide1.xml"));
  expect(xml).toContain('delay="indefinite"');
  expect(xml).toContain('vol="45000"');
  expect(xml).toContain('repeatCount="indefinite"');
  expect(xml).toContain('st="100" end="200"');
  const inventory = await readMedia(output, {}, context);
  expect(inventory.occurrences).toHaveLength(1);
  expect(inventory.occurrences[0]!.relationships).toHaveLength(2);
  expect(inventory.occurrences[0]!.posters).toHaveLength(1);
  for (const reference of inventory.occurrences[0]!.relationships)
    expect(files.get(reference.mediaPart!.slice(1))).toEqual(clip);
  expect(inventory.playbackVerified).toBe(false);
});
it.each([
  { poster: undefined },
  { contentType: "image/png" },
  { bytes: new Uint8Array([1, 2, 3]) },
  { kind: "audio" },
  { width: 0 },
  { volume: 100001 },
  { trimStart: -1 }
])("rejects inadmissible media %j", async (change) => {
  const source = await createPresentation({ slides: [{}] }, context);
  await expect(addMedia(source, { ...options, ...change } as never, context)).rejects.toBeDefined();
});
it("rejects clip and poster byte budgets before package mutation", async () => {
  await expect(
    addMedia(new Uint8Array(), { ...options, bytes: new Uint8Array(100001) }, context)
  ).rejects.toMatchObject({ code: "resource-limit" });
  await expect(
    addMedia(
      new Uint8Array(),
      { ...options, poster: { ...poster, bytes: new Uint8Array(100001) } },
      context
    )
  ).rejects.toMatchObject({ code: "resource-limit" });
});
it("replaces both clip bindings and explicit poster while retaining playback metadata", async () => {
  const source = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    { ...options, trimStart: 30, trimEnd: 70, loop: true, volume: 51000 },
    context
  );
  const before = (await readMedia(source, {}, context)).occurrences[0]!;
  const changed = clip.slice();
  changed[15] = 2;
  const output = await replaceMedia(
    source,
    { slide: 1, shape: before.shapeName!, bytes: changed, poster },
    context
  );
  const after = (await readMedia(output.bytes, {}, context)).occurrences[0]!;
  expect(output.affected).toBe(1);
  expect(after.timing).toEqual(before.timing);
  expect(after.playback.map((x) => x.xml)).toEqual(before.playback.map((x) => x.xml));
  const files = parts(output.bytes);
  for (const edge of after.relationships)
    expect(files.get(edge.mediaPart!.slice(1))).toEqual(changed);
});
it("requires an explicit replacement poster", async () => {
  const source = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    options,
    context
  );
  await expect(
    replaceMedia(source, { slide: 1, shape: "Media 2", bytes: clip } as never, context)
  ).rejects.toBeDefined();
});

it("requires supplied audio posters and rejects hostile option records without invoking getters", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const getter = vi.fn(() => "video/mp4");
  const hostile = { ...options };
  Object.defineProperty(hostile, "contentType", { get: getter });
  await expect(addMedia(input, hostile, context)).rejects.toBeDefined();
  expect(getter).not.toHaveBeenCalled();
  for (const change of [
    { unexpected: true },
    { contentType: null },
    { poster: null },
    { kind: null },
    { contentType: { toString: () => "video/mp4" } }
  ])
    await expect(
      addMedia(input, { ...options, ...change } as never, context)
    ).rejects.toBeDefined();
  await expect(
    addMedia(
      input,
      { ...options, kind: "audio", contentType: "audio/mp4", poster: undefined } as never,
      context
    )
  ).rejects.toBeDefined();
  const result = await addMedia(
    input,
    { ...options, kind: "audio", contentType: "audio/mp4" },
    context
  );
  expect((await readMedia(result, {}, context)).occurrences[0]!.kind).toBe("audio");
});
it.each([false, true])(
  "replaces imported shared clip resources with explicit shared policy %s",
  async (shared) => {
    const { storedArchive } = await import("../tests/fixtures/archive.js");
    let source = await addMedia(
      await createPresentation({ slides: [{}] }, context),
      options,
      context
    );
    source = await addMedia(source, options, context);
    const clips = (await readMedia(source, {}, context)).occurrences;
    const files = parts(source);
    const relPath = "ppt/slides/_rels/slide1.xml.rels";
    let relations = parseXmlPart(files.get(relPath)!, context.xmlLimits);
    for (const reference of clips[1]!.relationships) {
      const node = relations.root.children.find(
        (node) => attr(node, "Id") === reference.relationshipId
      )!;
      relations = relations.merge(node, {
        attributes: [
          { namespace: "", localName: "Target", value: clips[0]!.relationships[0]!.target }
        ]
      });
    }
    files.set(relPath, relations.bytes());
    source = storedArchive([...files].map(([name, bytes]) => ({ name, bytes })));
    const changed = clip.slice();
    changed[15] = 3;
    const result = await replaceMedia(
      source,
      { slide: 1, shape: clips[0]!.shapeName!, bytes: changed, poster, shared },
      context
    );
    const after = (await readMedia(result.bytes, {}, context)).occurrences;
    const resultFiles = parts(result.bytes);
    expect(result.affected).toBe(shared ? 2 : 1);
    expect(after[0]!.relationships[0]!.mediaPart === after[1]!.relationships[0]!.mediaPart).toBe(
      shared
    );
    expect(resultFiles.get(after[1]!.relationships[0]!.mediaPart!.slice(1))).toEqual(
      shared ? changed : clip
    );
    expect(new TextDecoder().decode(resultFiles.get("ppt/slides/slide1.xml"))).toContain('id="2"');
  }
);
it("refuses imported contradictory clip bindings instead of erasing one resource", async () => {
  const { storedArchive } = await import("../tests/fixtures/archive.js");
  let source = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    options,
    context
  );
  const distinct = clip.slice();
  distinct[15] = 9;
  source = await addMedia(source, { ...options, bytes: distinct }, context);
  const clips = (await readMedia(source, {}, context)).occurrences;
  const files = parts(source),
    path = "ppt/slides/_rels/slide1.xml.rels";
  const relations = parseXmlPart(files.get(path)!, context.xmlLimits);
  const ref = clips[0]!.relationships[1]!;
  const node = relations.root.children.find((node) => attr(node, "Id") === ref.relationshipId)!;
  files.set(
    path,
    relations
      .merge(node, {
        attributes: [
          { namespace: "", localName: "Target", value: clips[1]!.relationships[0]!.target }
        ]
      })
      .bytes()
  );
  source = storedArchive([...files].map(([name, bytes]) => ({ name, bytes })));
  await expect(
    replaceMedia(source, { slide: 1, shape: clips[0]!.shapeName!, bytes: clip, poster }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it("detaches a replacement poster relationship also used by an ordinary picture", async () => {
  const { addImage } = await import("./image-insertion.js");
  const { readImages } = await import("./images.js");
  const { storedArchive } = await import("../tests/fixtures/archive.js");
  let source = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    options,
    context
  );
  source = await addImage(
    source,
    { slide: 1, bytes: poster.bytes, contentType: poster.contentType, width: 100, height: 100 },
    context
  );
  const images = (await readImages(source, {}, context)).occurrences;
  const media = (await readMedia(source, {}, context)).occurrences[0]!;
  const files = parts(source),
    path = "ppt/slides/slide1.xml";
  const slide = parseXmlPart(files.get(path)!, context.xmlLimits);
  const nodes = (node: XmlElement): XmlElement[] => [node, ...node.children.flatMap(nodes)];
  const binding = nodes(slide.root).find((node) =>
    node.attributes.some(
      (attribute) =>
        attribute.name.localName === "embed" && attribute.value === images[1]!.relationshipId
    )
  )!;
  files.set(
    path,
    slide
      .merge(binding, {
        attributes: [
          {
            namespace: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            localName: "embed",
            value: images[0]!.relationshipId
          }
        ]
      })
      .bytes()
  );
  source = storedArchive([...files].map(([name, bytes]) => ({ name, bytes })));
  const result = await replaceMedia(
    source,
    { slide: 1, shape: media.shapeName!, bytes: clip, poster },
    context
  );
  const after = (await readImages(result.bytes, {}, context)).occurrences;
  expect(after[1]!.mediaPart).toBe(images[0]!.mediaPart);
  expect(after[0]!.relationshipId).not.toBe(after[1]!.relationshipId);
  expect(after[0]!.mediaPart).not.toBe(after[1]!.mediaPart);
});
const riff = (type: string) =>
  new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, ...[...type].map((c) => c.charCodeAt(0))]);
const asf = new Uint8Array([
  48, 38, 178, 117, 142, 102, 207, 17, 166, 217, 0, 170, 0, 98, 206, 108, 30, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 2
]);
const containers: readonly [string, "audio" | "video", Uint8Array, string][] = [
  ["video/mp4", "video", clip, "mp4"],
  ["audio/mp4", "audio", clip, "m4a"],
  [
    "video/quicktime",
    "video",
    new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 113, 116, 32, 32, 0, 0, 0, 0]),
    "mov"
  ],
  ["video/mpeg", "video", new Uint8Array([0, 0, 1, 186, 0, 0, 0, 0, 0, 0, 0, 0]), "mpg"],
  ["audio/mpeg", "audio", new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), "mp3"],
  ["audio/wav", "audio", riff("WAVE"), "wav"],
  ["audio/x-wav", "audio", riff("WAVE"), "wav"],
  ["video/x-msvideo", "video", riff("AVI "), "avi"],
  ["video/x-ms-wmv", "video", asf, "wmv"],
  ["audio/x-ms-wma", "audio", asf, "wma"]
];
it.each(containers)(
  "admits supplied %s container bytes without claiming codec or playback validation",
  async (contentType, kind, bytes, extension) => {
    const source = await createPresentation({ slides: [{}] }, context);
    const result = await addMedia(source, { ...options, bytes, contentType, kind }, context);
    const media = await readMedia(result, {}, context);
    expect(media.occurrences[0]!.kind).toBe(kind);
    expect(media.media[0]!.contentType).toBe(contentType);
    expect(media.media[0]!.part.endsWith(`.${extension}`)).toBe(true);
    expect(parts(result).get(media.media[0]!.part.slice(1))).toEqual(bytes);
    expect(media.playbackVerified).toBe(false);
    const corrupt = bytes.slice();
    corrupt[0] = 255;
    await expect(
      addMedia(source, { ...options, bytes: corrupt, contentType, kind }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    await expect(
      addMedia(
        source,
        { ...options, bytes, contentType, kind: kind === "audio" ? "video" : "audio" },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  }
);
it.each([
  new Uint8Array([0, 0, 0, 255, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]),
  new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 1])
])("rejects truncated and trailing container structures %j", async (bytes) => {
  await expect(addMedia(new Uint8Array(), { ...options, bytes }, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
});
it("authors an explicit manual media activation action without automatic start", async () => {
  const result = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    options,
    context
  );
  const xml = new TextDecoder().decode(parts(result).get("ppt/slides/slide1.xml"));
  expect(xml).toContain('action="ppaction://media"');
  expect(xml).toContain('delay="indefinite"');
});
