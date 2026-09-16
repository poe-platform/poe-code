import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readMedia } from "./media.js";
import { readSelectionIndex } from "./selectors.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const m = "http://schemas.microsoft.com/office/powerpoint/2010/main";
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
function fixture(
  options: {
    poster?: boolean;
    broken?: boolean;
    strict?: boolean;
    extra?: string;
    spoof?: boolean;
    notes?: boolean;
    mediaOnly?: boolean;
    shapeExtra?: string;
    missing?: boolean;
    captionLink?: boolean;
  } = {}
) {
  const presentation = options.strict ? "http://purl.oclc.org/ooxml/presentationml/main" : p;
  const drawing = options.strict ? "http://purl.oclc.org/ooxml/drawingml/main" : a;
  const ns = options.strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const xml = (name: string, value: string) =>
    entries.push({ name, bytes: new TextEncoder().encode(value) });
  const rels = (name: string, rows: [string, string, string, boolean?][]) =>
    xml(
      name,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${type.includes(":") ? type : `${ns}/${type}`}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`
    );
  xml(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="mp4" ContentType="video/mp4"/><Default Extension="png" ContentType="image/png"/><Default Extension="vtt" ContentType="text/vtt"/></Types>'
  );
  rels("_rels/.rels", [["main", "officeDocument", "deck.xml"]]);
  xml(
    "deck.xml",
    `<p:presentation xmlns:p="${presentation}" xmlns:r="${ns}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst></p:presentation>`
  );
  rels("_rels/deck.xml.rels", [["slide", "slide", "slide.xml"]]);
  const pic = (id: number, body: string, poster = false) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Clip ${id}"/><p:nvPr>${body}</p:nvPr></p:nvPicPr>${poster ? '<p:blipFill><a:blip r:embed="poster"/></p:blipFill>' : ""}</p:pic>`;
  xml(
    "slide.xml",
    `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${ns}" xmlns:m="${options.spoof ? "urn:untrusted" : m}" xmlns:c="http://schemas.microsoft.com/office/powerpoint/2017/3/main"><p:cSld><p:spTree>${pic(2, `${options.mediaOnly ? "" : '<a:videoFile r:link="video"/>'}<p:extLst><p:ext uri="media"><m:media r:embed="media"><m:trim st="1.25" end="8"/><m:extLst><p:ext uri="tracks"><c:tracksInfo displayLoc="media"><c:trackLst><c:track id="{82C5B42E-6860-42B6-9F87-56C0C9A44872}" label="English" r:embed="captions" ${options.captionLink ? 'r:link="captionRemote"' : ""} lang="en"/></c:trackLst></c:tracksInfo></p:ext></m:extLst></m:media></p:ext></p:extLst>`, options.poster !== false)}${pic(3, '<a:videoFile r:link="second"/>')}${pic(4, '<a:audioFile r:link="remote"/>')}${options.shapeExtra ?? ""}</p:spTree></p:cSld><p:timing><p:tnLst><p:video><p:cMediaNode vol="45000" mute="0"><p:cTn id="6" repeatCount="indefinite"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cMediaNode></p:video><p:audio><p:cMediaNode><p:cTn id="7"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cMediaNode></p:audio></p:tnLst></p:timing>${options.extra ?? ""}</p:sld>`
  );
  rels("_rels/slide.xml.rels", [
    [options.missing ? "absent" : "video", options.broken ? "image" : "video", "clip.mp4"],
    ["media", "http://schemas.microsoft.com/office/2007/relationships/media", "clip.mp4"],
    ["second", "video", "clip.mp4"],
    ["remote", "audio", "file:///private/audio.wav", true],
    ["poster", "image", "poster.png"],
    [
      "captions",
      "http://schemas.microsoft.com/office/2017/04/relationships/track",
      "subtitles.vtt"
    ],
    ["notes", "notesSlide", "notes.xml"],
    ["orphan", "audio", "https://example.invalid/sound.wav", true],
    [
      "captionRemote",
      "http://schemas.microsoft.com/office/2017/04/relationships/track",
      "https://example.invalid/captions.vtt",
      true
    ]
  ]);
  xml(
    "notes.xml",
    `<p:notes xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${ns}"><p:cSld><p:spTree>${options.notes ? pic(8, '<a:audioFile r:link="sound"/>') : ""}</p:spTree></p:cSld></p:notes>`
  );
  rels("_rels/notes.xml.rels", [
    ["sound", "audio", "https://example.invalid/notes.wav", true],
    ["master", "notesMaster", "notes-master.xml"]
  ]);
  xml(
    "notes-master.xml",
    `<p:notesMaster xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${ns}"><p:cSld><p:spTree>${options.notes ? pic(8, '<a:audioFile r:link="sound"/>') : ""}</p:spTree></p:cSld></p:notesMaster>`
  );
  rels("_rels/notes-master.xml.rels", [
    ["sound", "audio", "https://example.invalid/notes-master.wav", true]
  ]);
  entries.push(
    { name: "clip.mp4", bytes: clip },
    { name: "poster.png", bytes: new Uint8Array([137, 80, 78, 71]) },
    {
      name: "subtitles.vtt",
      bytes: new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n")
    }
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", storedArchive(entries));
  return new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
}
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
    return {
      read: async (max: number) => {
        if (offset === value.length) return null;
        const chunk = value.slice(offset, offset + max);
        offset += chunk.length;
        return chunk;
      }
    };
  };
  const path = {
    path: "/deck.pptx",
    capability: {
      openRead: async (path: string) => {
        opened.push(path);
        return source(new Uint8Array(fs.readFileSync(path) as Buffer));
      }
    }
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
