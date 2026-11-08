import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addMedia, replaceMedia, readMedia } from "./index.js";
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
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const m = "http://schemas.microsoft.com/office/powerpoint/2010/main";
async function annotated(extra: (clipId: string, posterId: string) => string) {
  const source = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    options,
    context
  );
  const occurrence = (await readMedia(source, {}, context)).occurrences[0]!;
  const files = parts(source);
  const path = "ppt/slides/slide1.xml";
  const doc = parseXmlPart(files.get(path)!, context.xmlLimits);
  const media = doc.root.children
    .flatMap(function visit(node): (typeof doc.root)[] {
      return [node, ...node.children.flatMap(visit)];
    })
    .find((node) => node.name.namespace === m && node.name.localName === "media")!;
  files.set(
    path,
    doc
      .spliceChildren(media, media.children.length, 0, [
        extra(occurrence.relationships[1]!.relationshipId, occurrence.posters[0]!.relationshipId)
      ])
      .bytes()
  );
  return {
    source: storedArchive([...files].map(([name, bytes]) => ({ name, bytes }))),
    name: occurrence.shapeName!,
    files
  };
}
it.each(["clip", "poster"])(
  "rejects replacement when an opaque track aliases the %s binding",
  async (kind) => {
    const { source, name } = await annotated(
      (clipId, posterId) =>
        `<m:extLst xmlns:m="${m}"><m:ext uri="opaque"><q:track xmlns:q="urn:original:track" xmlns:r="${r}" r:embed="${kind === "clip" ? clipId : posterId}" label="Gaeilge"/></m:ext></m:extLst>`
    );
    const before = source.slice();
    await expect(
      replaceMedia(source, { slide: 1, shape: name, bytes: clip, poster }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(source).toEqual(before);
  }
);
it("preserves unknown track metadata and extension fallback bytes", async () => {
  const extra = `<m:extLst xmlns:m="${m}"><m:ext uri="opaque"><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:q="urn:original:track"><mc:Choice Requires="q"><q:track label="日本語" start="1.25" end="8.75" q:future="retain"/></mc:Choice><mc:Fallback><q:track label="Gaeilge" start="0" end="2"/></mc:Fallback></mc:AlternateContent></m:ext></m:extLst>`;
  const { source, name } = await annotated(() => extra);
  const changed = clip.slice();
  changed[15] = 7;
  const result = await replaceMedia(
    source,
    { slide: 1, shape: name, bytes: changed, poster },
    context
  );
  const files = parts(result.bytes);
  expect(new TextDecoder().decode(files.get("ppt/slides/slide1.xml"))).toContain(extra);
  expect(files.get("ppt/media/clip1.mp4")).toEqual(clip);
  expect(
    [...files.values()].some(
      (bytes) => bytes.length === changed.length && bytes.every((value, i) => value === changed[i])
    )
  ).toBe(true);
});
it("retains multilingual caption tracks, cue ranges and external link metadata", async () => {
  const tracks = `<m:extLst xmlns:m="${m}"><p:ext xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" uri="{3AFAAA56-56D3-431D-BCD4-E75A35582382}"><c:tracksInfo xmlns:c="http://schemas.microsoft.com/office/powerpoint/2017/3/main" xmlns:r="${r}" displayLoc="media"><c:trackLst><c:track id="{E620E321-721C-4622-8809-84F97C748391}" label="日本語" lang="ja-JP" r:embed="captionA"/><c:track id="{D4982BB7-C8A0-4C36-AFA1-2137AA0FC293}" label="Gaeilge" lang="ga-IE" r:embed="captionB" r:link="captionLink"/><c:track id="{4230CF7B-0995-47B8-A3AA-854C438CB66B}" label="Notes" r:embed="captionC"/></c:trackLst></c:tracksInfo></p:ext></m:extLst>`;
  const initial = await annotated(() => tracks);
  const files = initial.files;
  const encoder = new TextEncoder();
  const cues = [
    "WEBVTT\n\n00:00:01.250 --> 00:00:03.750\n海の観察\n",
    "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nAn fharraige\n"
  ];
  files.set("ppt/media/caption-a.vtt", encoder.encode(cues[0]!));
  files.set("ppt/media/caption-b.vtt", encoder.encode(cues[1]!));
  files.set("ppt/media/caption-c.dat", encoder.encode(cues[0]!));
  const types = parseXmlPart(files.get("[Content_Types].xml")!, context.xmlLimits);
  files.set(
    "[Content_Types].xml",
    types
      .spliceChildren(types.root, types.root.children.length, 0, [
        `<Default xmlns="${types.root.name.namespace}" Extension="vtt" ContentType="text/vtt"/>`,
        `<Override xmlns="${types.root.name.namespace}" PartName="/ppt/media/caption-c.dat" ContentType="text/vtt"/>`
      ])
      .bytes()
  );
  const path = "ppt/slides/_rels/slide1.xml.rels";
  const rels = parseXmlPart(files.get(path)!, context.xmlLimits);
  const relationshipType = "http://schemas.microsoft.com/office/2017/04/relationships/track";
  const additions = [
    `<Relationship xmlns="${rels.root.name.namespace}" Id="captionC" Type="${relationshipType}" Target="../media/caption-c.dat"/>`,
    `<Relationship xmlns="${rels.root.name.namespace}" Id="captionA" Type="${relationshipType}" Target="../media/caption-a.vtt"/>`,
    `<Relationship xmlns="${rels.root.name.namespace}" Id="captionB" Type="${relationshipType}" Target="../media/caption-b.vtt"/>`,
    `<Relationship xmlns="${rels.root.name.namespace}" Id="captionLink" Type="${relationshipType}" Target="https://captions.invalid/ga.vtt" TargetMode="External"/>`
  ];
  files.set(path, rels.spliceChildren(rels.root, rels.root.children.length, 0, additions).bytes());
  const source = storedArchive([...files].map(([name, bytes]) => ({ name, bytes })));
  const changed = clip.slice();
  changed[15] = 4;
  const result = await replaceMedia(
    source,
    { slide: 1, shape: initial.name, bytes: changed, poster },
    context
  );
  const after = parts(result.bytes);
  expect(new TextDecoder().decode(after.get("ppt/slides/slide1.xml"))).toContain(tracks);
  for (const addition of additions)
    expect(new TextDecoder().decode(after.get(path))).toContain(addition);
  expect(after.get("ppt/media/caption-c.dat")).toEqual(encoder.encode(cues[0]!));
  expect(after.get("ppt/media/caption-a.vtt")).toEqual(encoder.encode(cues[0]!));
  expect(after.get("ppt/media/caption-b.vtt")).toEqual(encoder.encode(cues[1]!));
  const caption = (await readMedia(result.bytes, {}, context)).occurrences[0]!.captions[0]!;
  expect(
    caption.relationships.map((ref) => [ref.relationshipId, ref.external, ref.contentType])
  ).toEqual([
    ["captionA", false, "text/vtt"],
    ["captionB", false, "text/vtt"],
    ["captionLink", true, null],
    ["captionC", false, "text/vtt"]
  ]);
});
it("authors the registered media extension identifier", async () => {
  const source = await addMedia(
    await createPresentation({ slides: [{}] }, context),
    options,
    context
  );
  const xml = new TextDecoder().decode(parts(source).get("ppt/slides/slide1.xml"));
  expect(xml).toContain('uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"');
});
