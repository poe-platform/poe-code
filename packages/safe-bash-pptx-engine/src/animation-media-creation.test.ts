import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { addMedia, createPresentation, readAnimations } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const clip = {
  slide: 1,
  kind: "video" as const,
  contentType: "video/mp4",
  bytes: new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]),
  poster: {
    contentType: "image/gif",
    bytes: new Uint8Array([
      71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0,
      1, 0, 0, 2, 2, 68, 1, 0, 59
    ])
  },
  left: 0,
  top: 0,
  width: 100,
  height: 100
};
function slide(bytes: Uint8Array) {
  return parseXmlPart(
    inspectZip(bytes).find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload,
    context.xmlLimits
  );
}
function nodes(root: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [],
    pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.namespace === p && node.name.localName === name) found.push(node);
    pending.push(...[...node.children].reverse());
  }
  return found;
}
function attribute(node: XmlElement, name: string) {
  return node.attributes.find(
    (value) => value.name.namespace === "" && value.name.localName === name
  )?.value;
}
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

it.each(["absent", "existing-video", "missing-child-list"] as const)(
  "creates valid inert video timing from %s",
  async (variant) => {
    const volume = Volume.fromJSON({});
    let source = await createPresentation({ slides: [{}] }, context);
    const opaque =
      '<p:extLst><p:ext uri="urn:retained:annotation"><note xmlns="urn:annotation">  keep spacing  </note></p:ext></p:extLst>';
    if (variant === "existing-video") source = await addMedia(source, clip, context);
    if (variant === "missing-child-list") {
      const document = slide(source);
      source = await writePackageArchive(
        inspectZip(source).map((entry) => ({
          name: entry.name,
          bytes:
            entry.name === "ppt/slides/slide1.xml"
              ? document
                  .spliceChildren(document.root, 1, 0, [
                    `<p:timing xmlns:p="${p}"><p:tnLst><p:par><p:cTn id="1"/></p:par></p:tnLst>${opaque}</p:timing>`
                  ])
                  .bytes()
              : entry.payload
        })),
        context,
        { compression: "store" }
      );
    }
    volume.writeFileSync("/source.pptx", source);
    const originalDocument = slide(source);
    const previousVideo = nodes(originalDocument.root, "video")[0];
    const originalMarkup = previousVideo ? originalDocument.markup(previousVideo) : null;
    const output = await addMedia(
      new Uint8Array(volume.readFileSync("/source.pptx") as Buffer),
      clip,
      context
    );
    const doc = slide(output),
      videos = nodes(doc.root, "video");
    expect(videos).toHaveLength(variant === "existing-video" ? 2 : 1);
    expect(nodes(doc.root, "cTn").map((node) => attribute(node, "id"))).toEqual(
      variant === "absent" ? ["1"] : ["1", "2"]
    );
    expect(videos.map((video) => attribute(nodes(video, "spTgt")[0]!, "spid"))).toEqual(
      variant === "existing-video" ? ["2", "3"] : ["2"]
    );
    expect(videos.map((video) => attribute(nodes(video, "cond")[0]!, "delay"))).toEqual(
      variant === "existing-video" ? ["indefinite", "indefinite"] : ["indefinite"]
    );
    if (originalMarkup) expect(doc.markup(videos[0]!)).toBe(originalMarkup);
    if (variant === "missing-child-list")
      expect(new TextDecoder().decode(doc.bytes())).toContain(opaque);
    expect((await readAnimations(output, {}, context))[0]!.diagnostics).toEqual([]);
    expect(new Uint8Array(volume.readFileSync("/source.pptx") as Buffer)).toEqual(source);
  }
);
