import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { addImage } from "./image-insertion.js";
import { addMedia } from "./media-editing.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";

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
const image = Uint8Array.of(
  71,
  73,
  70,
  56,
  57,
  97,
  1,
  0,
  1,
  0,
  128,
  0,
  0,
  0,
  0,
  0,
  75,
  120,
  30,
  44,
  0,
  0,
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  2,
  2,
  68,
  1,
  0,
  59
);
const clip = Uint8Array.of(0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0);

it.each([
  ["image", [3, 4, 2], 1],
  ["image", [4, 2, 1], 3],
  ["image", [2, 3, 1], 4],
  ["clip", [3, 4, 2], 1],
  ["clip", [4, 2, 1], 3],
  ["clip", [2, 3, 1], 4]
] as const)("allocates an unoccupied %s part among %j", async (kind, occupied, expected) => {
  const extension = kind === "image" ? "gif" : "mp4";
  const contentType = kind === "image" ? "image/gif" : "video/mp4";
  const entries = inspectZip(await createPresentation({ slides: [{}] }, context));
  const members = entries.map((entry) => {
    if (entry.name !== "[Content_Types].xml") return { name: entry.name, bytes: entry.payload };
    const doc = parseXmlPart(entry.payload, context.xmlLimits);
    return {
      name: entry.name,
      bytes: doc
        .spliceChildren(
          doc.root,
          doc.root.children.length,
          0,
          occupied.map(
            (index) =>
              `<Override xmlns="${doc.root.name.namespace}" PartName="/ppt/media/${kind}${index}.${extension}" ContentType="${contentType}"/>`
          )
        )
        .bytes()
    };
  });
  for (const index of occupied)
    members.push({
      name: `ppt/media/${kind}${index}.${extension}`,
      bytes: Uint8Array.of(index, 0, 255)
    });
  const input = storedArchive(members);
  const output =
    kind === "image"
      ? await addImage(input, { slide: 1, bytes: image, contentType }, context)
      : await addMedia(
          input,
          {
            slide: 1,
            bytes: clip,
            contentType,
            kind: "video",
            poster: { bytes: image, contentType: "image/gif" },
            left: 0,
            top: 0,
            width: 914400,
            height: 914400
          },
          context
        );
  const result = inspectZip(output);
  expect(
    result.find((entry) => entry.name === `ppt/media/${kind}${expected}.${extension}`)?.payload
  ).toEqual(kind === "image" ? image : clip);
  for (const index of occupied)
    expect(
      result.find((entry) => entry.name === `ppt/media/${kind}${index}.${extension}`)?.payload
    ).toEqual(Uint8Array.of(index, 0, 255));
});

it.each([
  [[], 1],
  [[1], 2],
  [[1, 2], 3],
  [[2, 4], 1],
  [[1, 4], 2],
  [[2, 3], 1],
  [[1, 3], 2]
] as const)("allocates the first free slide URI among %j", async (occupied, expected) => {
  const { addSlide } = await import("./slides.js");
  const template = inspectZip(await createPresentation({ slides: [{}] }, context)).find(
    (entry) => entry.name === "ppt/slides/slide1.xml"
  )!.payload;
  const entries = inspectZip(await createPresentation({}, context));
  const members = entries.map((entry) => {
    if (entry.name !== "[Content_Types].xml" || !occupied.length)
      return { name: entry.name, bytes: entry.payload };
    const doc = parseXmlPart(entry.payload, context.xmlLimits);
    return {
      name: entry.name,
      bytes: doc
        .spliceChildren(
          doc.root,
          doc.root.children.length,
          0,
          occupied.map(
            (index) =>
              `<Override xmlns="${doc.root.name.namespace}" PartName="/ppt/slides/slide${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
          )
        )
        .bytes()
    };
  });
  for (const index of occupied) {
    members.push({ name: `ppt/slides/slide${index}.xml`, bytes: template });
    members.push({
      name: `ppt/slides/_rels/slide${index}.xml.rels`,
      bytes: new TextEncoder().encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
      )
    });
  }
  const output = await addSlide(
    storedArchive(members),
    { layout: "/ppt/slideLayouts/slideLayout1.xml", name: "New page" },
    context
  );
  const result = inspectZip(output);
  const added = new TextDecoder().decode(
    result.find((entry) => entry.name === `ppt/slides/slide${expected}.xml`)?.payload
  );
  expect(added).toContain('name="New page"');
  for (const index of occupied)
    expect(result.find((entry) => entry.name === `ppt/slides/slide${index}.xml`)?.payload).toEqual(
      template
    );
});

it.each([true, false])(
  "deduplicates media only when complete payloads agree: %s",
  async (matches) => {
    const options = {
      slide: 1,
      bytes: clip,
      contentType: "video/mp4",
      kind: "video" as const,
      poster: { bytes: image, contentType: "image/gif" },
      left: 0,
      top: 0,
      width: 914400,
      height: 914400
    };
    const source = await addMedia(
      await createPresentation({ slides: [{}] }, context),
      options,
      context
    );
    const next = new Uint8Array(clip);
    if (!matches) next[next.length - 1] = 1;
    const output = await addMedia(source, { ...options, bytes: next }, context);
    const movies = inspectZip(output).filter((entry) => entry.name.endsWith(".mp4"));
    expect(movies.map((entry) => entry.name)).toEqual(
      matches ? ["ppt/media/clip1.mp4"] : ["ppt/media/clip1.mp4", "ppt/media/clip2.mp4"]
    );
    expect(movies[0]!.payload).toEqual(clip);
    expect(movies.at(-1)!.payload).toEqual(next);
  }
);

it.each([true, false])(
  "keeps picture insertions independently owned when payloads match: %s",
  async (matches) => {
    const source = await addImage(
      await createPresentation({ slides: [{}] }, context),
      { slide: 1, bytes: image, contentType: "image/gif" },
      context
    );
    const next = new Uint8Array(image);
    if (!matches) next[16] = 25;
    const output = await addImage(
      source,
      { slide: 1, bytes: next, contentType: "image/gif" },
      context
    );
    const pictures = inspectZip(output).filter((entry) => entry.name.endsWith(".gif"));
    expect(pictures.map((entry) => entry.name)).toEqual([
      "ppt/media/image1.gif",
      "ppt/media/image2.gif"
    ]);
    expect(pictures[0]!.payload).toEqual(image);
    expect(pictures[1]!.payload).toEqual(next);
  }
);
