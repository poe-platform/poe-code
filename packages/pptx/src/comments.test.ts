import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { importSlides } from "./slide-import.js";
import { removeSlides } from "./slide-removal.js";
import { createPresentation } from "./creation.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { mutateComments, readComments } from "./comments.js";
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
const selection = {
  kind: "slide" as const,
  position: { coordinateSystem: "one-based" as const, value: 1 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const timestamp = "2030-04-05T12:30:00Z";
function entries(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((e) => [
      e.name,
      new TextDecoder().decode(e.payload)
    ])
  );
}
describe("legacy slide comments", () => {
  it("creates explicit author identity, increasing indices, eighth-point positions and escaped text", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    expect(await readComments(source, {}, context)).toEqual([]);
    const first = await mutateComments(
      source,
      "add",
      {
        selection,
        text: "Review <this> & that",
        author: "Jordan",
        timestamp,
        left: 12700,
        top: -12700
      },
      context
    );
    const second = await mutateComments(
      first.bytes,
      "add",
      { selection, text: "Second", author: "Jordan", timestamp },
      context
    );
    expect(await readComments(second.bytes, {}, context)).toMatchObject([
      {
        id: "0:1",
        authorId: "0",
        index: 1,
        author: "Jordan",
        timestamp,
        left: 12700,
        top: -12700,
        text: "Review <this> & that"
      },
      { id: "0:2", index: 2, left: 0, top: 0 }
    ]);
    const parts = entries(second.bytes);
    expect(parts.get("ppt/comments/comment1.xml")).toContain('x="8" y="-8"');
    expect(parts.get("ppt/commentAuthors.xml")).toContain('lastIdx="2"');
    expect(parts.get("ppt/slides/slide1.xml")).toEqual(
      entries(source).get("ppt/slides/slide1.xml")
    );
  });
  it("declares the exact legacy comment content type and supports import then slide deletion", async () => {
    const destination = await createPresentation({ slides: [{}] }, context);
    const authored = await mutateComments(
      destination,
      "add",
      {
        selection,
        text: "Portable review",
        author: "Morgan",
        authorId: "12",
        timestamp,
        left: 25400
      },
      context
    );
    expect(entries(authored.bytes).get("[Content_Types].xml")).toContain(
      'PartName="/ppt/comments/comment1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"'
    );
    const imported = await importSlides(
      destination,
      authored.bytes,
      { sourceSlides: [1] },
      context
    );
    expect(await readComments(imported, {}, context)).toMatchObject([
      { slide: 2, text: "Portable review", author: "Morgan", timestamp, left: 25400, index: 1 }
    ]);
    const deleted = await removeSlides(
      imported,
      { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } } },
      context
    );
    expect(await readComments(deleted, {}, context)).toEqual([]);
    expect([...entries(deleted).values()].some((xml) => xml.includes('name="Morgan"'))).toBe(false);
  });
  it("rejects edits to comment parts referenced by an unselected slide", async () => {
    let bytes = await createPresentation({ slides: [{}, {}] }, context);
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection, text: "Shared", author: "A", timestamp },
        context
      )
    ).bytes;
    const map = new Map<string, Uint8Array>(inspectZip(bytes).map((e) => [e.name, e.payload]));
    const name = "ppt/slides/_rels/slide2.xml.rels",
      doc = parseXmlPart(map.get(name)!, context.xmlLimits);
    map.set(
      name,
      doc
        .spliceChildren(doc.root, doc.root.children.length, 0, [
          '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="sharedReview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/>'
        ])
        .bytes()
    );
    bytes = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    await expect(
      mutateComments(bytes, "set", { selection, id: "0:1", text: "Changed" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    await expect(
      mutateComments(bytes, "remove", { selection, id: "0:1" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    await expect(
      mutateComments(bytes, "add", { selection, text: "Another", author: "A", timestamp }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("edits only selected fields and removes an author only after its final reference", async () => {
    let bytes = await createPresentation({ slides: [{}, {}] }, context);
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection, text: "One", author: "Jordan", timestamp },
        context
      )
    ).bytes;
    const other = { ...selection, position: { ...selection.position, value: 2 } };
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection: other, text: "Two", author: "Jordan", timestamp },
        context
      )
    ).bytes;
    const edited = await mutateComments(
      bytes,
      "set",
      { selection, id: "0:1", text: "Changed" },
      context
    );
    expect((await readComments(edited.bytes, { selection }, context))[0]).toMatchObject({
      id: "0:1",
      text: "Changed",
      timestamp
    });
    const removed = await mutateComments(edited.bytes, "remove", { selection, id: "0:1" }, context);
    expect(entries(removed.bytes).get("ppt/commentAuthors.xml")).toContain('name="Jordan"');
    const last = await mutateComments(
      removed.bytes,
      "remove",
      { selection: other, id: "0:2" },
      context
    );
    expect(entries(last.bytes).get("ppt/commentAuthors.xml")).not.toContain('name="Jordan"');
  });
  it("requires explicit timestamps and prevents ambiguous edits", async () => {
    const bytes = await createPresentation({ slides: [{}] }, context);
    await expect(
      mutateComments(bytes, "add", { selection, text: "x", author: "A" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    await expect(
      mutateComments(
        bytes,
        "add",
        { selection, id: "0:99", text: "x", author: "A", timestamp },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
    for (const value of ["today", "2030-02-30T00:00:00Z", "2030-01-01"])
      await expect(
        mutateComments(
          bytes,
          "add",
          { selection, text: "x", author: "A", timestamp: value },
          context
        )
      ).rejects.toMatchObject({ code: "invalid-value" });
    let two = (
      await mutateComments(bytes, "add", { selection, text: "x", author: "A", timestamp }, context)
    ).bytes;
    two = (
      await mutateComments(two, "add", { selection, text: "y", author: "A", timestamp }, context)
    ).bytes;
    await expect(
      mutateComments(two, "set", { selection, text: "z" }, context)
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
  });
  it("uses fingerprinted comment tokens and rounds supplied geometry and timestamps", async () => {
    let bytes = await createPresentation({ slides: [{}] }, context);
    bytes = (
      await mutateComments(
        bytes,
        "add",
        {
          selection,
          text: "A",
          author: "A",
          timestamp: "2030-04-05T12:30:00.125Z",
          left: 1000,
          top: -1000
        },
        context
      )
    ).bytes;
    bytes = (
      await mutateComments(bytes, "add", { selection, text: "B", author: "A", timestamp }, context)
    ).bytes;
    const first = (await readComments(bytes, {}, context))[0]!;
    expect(first).toMatchObject({ timestamp, left: 1587.5, top: -1587.5 });
    expect(first.location.objectId).toBe("0:1");
    expect(
      await readComments(bytes, { selection: { token: first.selector } }, context)
    ).toHaveLength(1);
    const edited = await mutateComments(
      bytes,
      "set",
      { selection: { token: first.selector }, text: "Only A" },
      context
    );
    expect((await readComments(edited.bytes, {}, context)).map((r) => r.text)).toEqual([
      "Only A",
      "B"
    ]);
    await expect(
      readComments(edited.bytes, { selection: { token: first.selector } }, context)
    ).rejects.toMatchObject({ code: "stale-selection" });
  });
  it("keeps duplicate display names distinct and preserves unrelated annotation parts", async () => {
    let bytes = await createPresentation({ slides: [{}] }, context);
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection, text: "First", author: "Jordan", authorId: "7", initials: "J", timestamp },
        context
      )
    ).bytes;
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection, text: "Second", author: "Jordan", authorId: "9", initials: "JJ", timestamp },
        context
      )
    ).bytes;
    await expect(
      mutateComments(
        bytes,
        "add",
        { selection, text: "Third", author: "Jordan", timestamp },
        context
      )
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    const map = new Map<string, Uint8Array>(inspectZip(bytes).map((e) => [e.name, e.payload]));
    const opaque = new TextEncoder().encode(
      '<thread xmlns="urn:review:modern"><message>Retain exactly</message></thread>'
    );
    map.set("ppt/annotations.xml", opaque);
    register(map, "/ppt/annotations.xml");
    bytes = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    const edited = await mutateComments(
      bytes,
      "set",
      { selection, id: "9:1", text: "Revised", left: 25400 },
      context
    );
    expect(await readComments(edited.bytes, {}, context)).toMatchObject([
      { id: "7:1", text: "First", initials: "J" },
      { id: "9:1", text: "Revised", initials: "JJ", left: 25400 }
    ]);
    expect(inspectZip(edited.bytes).find((e) => e.name === "ppt/annotations.xml")?.payload).toEqual(
      opaque
    );
    const reassigned = await mutateComments(
      edited.bytes,
      "set",
      { selection, id: "9:1", authorId: "7" },
      context
    );
    expect(await readComments(reassigned.bytes, {}, context)).toMatchObject([
      { id: "7:1" },
      { id: "7:2", text: "Revised", timestamp }
    ]);
  });
  it("retains author entries referenced by detached comment parts", async () => {
    let bytes = await createPresentation({ slides: [{}] }, context);
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection, text: "Visible", author: "A", timestamp },
        context
      )
    ).bytes;
    const map = new Map<string, Uint8Array>(inspectZip(bytes).map((e) => [e.name, e.payload]));
    map.set(
      "ppt/detached.data",
      new TextEncoder().encode(
        '<p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cm authorId="0" idx="70" dt="2030-04-05T12:30:00Z"><p:pos x="0" y="0"/><p:text>Detached</p:text></p:cm></p:cmLst>'
      )
    );
    register(map, "/ppt/detached.data");
    bytes = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    const second = await mutateComments(
      bytes,
      "add",
      { selection, text: "Next", author: "A", timestamp },
      context
    );
    expect((await readComments(second.bytes, {}, context))[1]?.index).toBe(71);
    const removed = await mutateComments(second.bytes, "remove", { selection, all: true }, context);
    expect(entries(removed.bytes).get("ppt/commentAuthors.xml")).toContain('name="A"');
  });
  it("rejects malformed position values and duplicate comment identities", async () => {
    let bytes = await createPresentation({ slides: [{}] }, context);
    bytes = (
      await mutateComments(bytes, "add", { selection, text: "A", author: "A", timestamp }, context)
    ).bytes;
    const map = new Map<string, Uint8Array>(inspectZip(bytes).map((e) => [e.name, e.payload]));
    const name = "ppt/comments/comment1.xml",
      doc = parseXmlPart(map.get(name)!, context.xmlLimits);
    map.set(
      name,
      doc
        .merge(doc.root.children[0]!.children[0]!, {
          attributes: [{ namespace: "", localName: "x", value: "NaN" }]
        })
        .bytes()
    );
    let invalid = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    await expect(readComments(invalid, {}, context)).rejects.toMatchObject({
      code: "invalid-value"
    });
    map.set(
      name,
      doc.spliceChildren(doc.root, 1, 0, [doc.markup(doc.root.children[0]!, true)]).bytes()
    );
    invalid = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    await expect(
      mutateComments(invalid, "set", { selection, id: "0:1", text: "Changed" }, context)
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
  });
  it("preserves extension attributes when moving a comment", async () => {
    let bytes = await createPresentation({ slides: [{}] }, context);
    bytes = (
      await mutateComments(
        bytes,
        "add",
        { selection, text: "Move", author: "A", timestamp },
        context
      )
    ).bytes;
    const map = new Map<string, Uint8Array>(inspectZip(bytes).map((e) => [e.name, e.payload]));
    const part = "ppt/comments/comment1.xml",
      doc = parseXmlPart(map.get(part)!, context.xmlLimits);
    const position = doc.root.children[0]!.children[0]!;
    map.set(
      part,
      doc
        .merge(position, { attributes: [{ namespace: "", localName: "custom", value: "retain" }] })
        .bytes()
    );
    bytes = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    const moved = await mutateComments(
      bytes,
      "set",
      { selection, id: "0:1", left: 12700 },
      context
    );
    expect(entries(moved.bytes).get(part)).toContain('custom="retain"');
  });
});

function register(map: Map<string, Uint8Array>, part: string) {
  const doc = parseXmlPart(map.get("[Content_Types].xml")!, context.xmlLimits);
  map.set(
    "[Content_Types].xml",
    doc
      .spliceChildren(doc.root, doc.root.children.length, 0, [
        `<Override xmlns="${doc.root.name.namespace}" PartName="${part}" ContentType="application/xml"/>`
      ])
      .bytes()
  );
}
