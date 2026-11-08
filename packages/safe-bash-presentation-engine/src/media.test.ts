import { chunksFromReader, streamingFileSystem } from "../tests/fixtures/streams.js";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mediaFixture as fixture } from "../tests/fixtures/media.js";
import { readMedia } from "./media.js";
import { readSelectionIndex } from "./selectors.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 262144, maxReads: 100, chunkBytes: 4096 },
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
const clip = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);
it("retains distinct bindings and occurrences when a clip part is shared", async () => {
  const result = await readMedia(fixture(), {}, context);
  expect(result.occurrences).toHaveLength(4);
  expect(result.occurrences[0]).toMatchObject({
    shapeId: "2",
    shapeName: "Clip 2",
    kind: "video",
    relationships: [
      {
        relationshipId: "video",
        external: false,
        mediaPart: "/clip.mp4",
        contentType: "video/mp4"
      },
      { relationshipId: "media", external: false, mediaPart: "/clip.mp4" }
    ]
  });
  expect(result.occurrences[1]).toMatchObject({
    shapeId: "3",
    relationships: [{ relationshipId: "second", mediaPart: "/clip.mp4" }]
  });
  expect(result.media).toEqual([
    {
      part: "/clip.mp4",
      contentType: "video/mp4",
      bytes: 12,
      sha256: createHash("sha256").update(clip).digest("hex"),
      sha1: createHash("sha1").update(clip).digest("hex"),
      occurrenceIds: [result.occurrences[0]!.id, result.occurrences[1]!.id]
    }
  ]);
  expect(result.playbackVerified).toBe(false);
});
it.each([true, false])("reports present and absent poster references (%s)", async (poster) => {
  const result = await readMedia(fixture({ poster }), { slide: 1, shape: "Clip 2" }, context);
  expect(result.occurrences[0]!.posters).toHaveLength(poster ? 1 : 0);
  if (poster)
    expect(result.occurrences[0]!.posters[0]).toMatchObject({
      relationshipId: "poster",
      mediaPart: "/poster.png",
      contentType: "image/png",
      bytes: 4,
      sha256: createHash("sha256")
        .update(new Uint8Array([137, 80, 78, 71]))
        .digest("hex")
    });
});
it("associates raw trim, captions and timing with the correct shape without playback claims", async () => {
  const result = await readMedia(fixture(), {}, context);
  const first = result.occurrences[0]!;
  expect(first.playback.some((x) => x.xml.includes('st="1.25" end="8"'))).toBe(true);
  expect(first.captions[0]).toMatchObject({
    relationships: [
      { relationshipId: "captions", mediaPart: "/subtitles.vtt", contentType: "text/vtt" }
    ]
  });
  expect(first.timing).toHaveLength(1);
  expect(first.timing[0]!.xml).toContain('vol="45000" mute="0"');
  expect(first.timing[0]!.xml).toContain('repeatCount="indefinite"');
  expect(result.occurrences[1]!.timing).toEqual([]);
  expect(result.occurrences[2]!.timing[0]!.xml).toContain('spid="4"');
});
it("keeps external file and URL media inert with no fabricated byte metadata", async () => {
  const result = await readMedia(fixture(), {}, context);
  expect(result.occurrences[2]).toMatchObject({
    kind: "audio",
    relationships: [
      {
        target: "file:///private/audio.wav",
        external: true,
        sha256: null,
        bytes: null,
        mediaPart: null
      }
    ]
  });
  expect(result.occurrences[3]).toMatchObject({
    shapeId: null,
    relationships: [{ target: "https://example.invalid/sound.wav", external: true }]
  });
});
it("uses shape names and opaque identities consistently", async () => {
  const source = fixture();
  const index = await readSelectionIndex(source, context);
  expect(
    (await readMedia(source, { slide: 1, shape: "Clip 3" }, context)).occurrences.map(
      (x) => x.shapeId
    )
  ).toEqual(["3"]);
  expect(
    (await readMedia(source, { select: index.objects[0]!.token }, context)).occurrences.map(
      (x) => x.shapeId
    )
  ).toEqual(["2"]);
  expect((await readMedia(source, { slide: 2 }, context)).occurrences).toEqual([]);
});
it("accepts strict relationship namespaces", async () => {
  expect((await readMedia(fixture({ strict: true }), {}, context)).occurrences[0]!.kind).toBe(
    "video"
  );
});
it("rejects a video binding with an image relationship", async () => {
  await expect(readMedia(fixture({ broken: true }), {}, context)).rejects.toMatchObject({
    code: "missing-binding"
  });
});
it.each([
  { shape: 1 },
  { shape: 0 },
  { slide: 1.5 },
  { select: "", shape: 1 },
  { scope: "wrong" },
  { extra: true }
])("rejects invalid selection options %j", async (options) => {
  await expect(readMedia(fixture(), options as never, context)).rejects.toBeDefined();
});

it("retains audio bindings outside shapes and foreign markup without claiming their semantics", async () => {
  const result = await readMedia(
    fixture({
      extra:
        '<p:transition><p:sndAc><p:stSnd><p:snd r:embed="orphan"/></p:stSnd></p:sndAc></p:transition>'
    }),
    {},
    context
  );
  expect(
    result.occurrences.find((x) => x.relationships.some((r) => r.relationshipId === "orphan"))
  ).toMatchObject({ shapeId: null, kind: "audio" });
});
it("does not interpret foreign media markup and still retains its relationship", async () => {
  const result = await readMedia(fixture({ spoof: true }), {}, context);
  expect(result.occurrences[0]!.playback).toEqual([]);
  expect(
    result.occurrences.find((x) => x.relationships.some((r) => r.relationshipId === "media"))
  ).toMatchObject({ shapeId: null });
});
it("uses declared content type for an extension-only media reference", async () => {
  const result = await readMedia(fixture({ mediaOnly: true }), {}, context);
  expect(result.occurrences[0]).toMatchObject({
    kind: "video",
    relationships: [{ relationshipId: "media" }]
  });
});

it("chooses the same compatible shape branch as the selector", async () => {
  const result = await readMedia(
    fixture({
      shapeExtra: `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:future"><mc:Choice Requires="f"><p:pic><p:nvPicPr><p:cNvPr id="9" name="Alternative"/><p:nvPr><a:videoFile r:link="second"/></p:nvPr></p:nvPicPr></p:pic></mc:Choice><mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="9" name="Alternative"/><p:nvPr><a:audioFile r:link="remote"/></p:nvPr></p:nvPicPr></p:pic></mc:Fallback></mc:AlternateContent>`
    }),
    { slide: 1, shape: "Alternative" },
    context
  );
  expect(result.occurrences).toHaveLength(1);
  expect(result.occurrences[0]).toMatchObject({
    shapeId: "9",
    kind: "audio",
    relationships: [{ relationshipId: "remote" }]
  });
});
it("retains both caption bindings as raw provenance without resolving external text", async () => {
  const result = await readMedia(
    fixture({ captionLink: true }),
    { slide: 1, shape: "Clip 2" },
    context
  );
  expect(
    result.occurrences[0]!.captions[0]!.relationships.map((r) => [r.relationshipId, r.external])
  ).toEqual([
    ["captions", false],
    ["captionRemote", true]
  ]);
});
it("rejects an absent media relationship", async () => {
  await expect(readMedia(fixture({ missing: true }), {}, context)).rejects.toMatchObject({
    code: "missing-binding"
  });
});
it("admits bounded streams and explicit in-memory paths without modifying source bytes", async () => {
  const bytes = fixture();
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", bytes);
  const opened: string[] = [];
  const source = (value: Uint8Array) => {
    let offset = 0;
    return chunksFromReader({
      read: async (max: number) => {
        if (offset === value.length) return null;
        const chunk = value.slice(offset, offset + max);
        offset += chunk.length;
        return chunk;
      }
    });
  };
  const path = {
    path: "/deck.pptx",
    fs: streamingFileSystem({
      openRead: async (path: string) => {
        opened.push(path);
        return source(new Uint8Array(fs.readFileSync(path) as Buffer));
      }
    })
  };
  expect((await readMedia(path, {}, context)).media[0]!.bytes).toBe(12);
  expect((await readMedia(source(bytes), {}, context)).occurrences[0]!.shapeId).toBe("2");
  expect(opened).toEqual(["/deck.pptx"]);
  expect(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)).toEqual(bytes);
});
it("rejects missing and ambiguous shape names before media filtering", async () => {
  await expect(readMedia(fixture(), { slide: 1, shape: "Absent" }, context)).rejects.toMatchObject({
    code: "missing-selection"
  });
  const shapeExtra = '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Clip 2"/></p:nvSpPr></p:sp>';
  await expect(
    readMedia(fixture({ shapeExtra }), { slide: 1, shape: "Clip 2" }, context)
  ).rejects.toMatchObject({ code: "ambiguous-selection" });
});

it.each(["notes", "notes-master"] as const)(
  "filters %s media by the owning slide",
  async (scope) => {
    const result = await readMedia(fixture({ notes: true }), { scope, slide: 1 }, context);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]!.sourcePart).toBe(
      scope === "notes" ? "/notes.xml" : "/notes-master.xml"
    );
  }
);
