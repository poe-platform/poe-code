import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { readMemberships, mutateMemberships } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const s = "http://schemas.microsoft.com/office/powerpoint/2010/main";
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/deck") as Buffer)).map((x) => [x.name, x.payload])
  );
}
function attributes(bytes: Uint8Array, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value])));
  });
  parser.write(new TextDecoder().decode(parts(bytes).get("ppt/presentation.xml"))).close();
  return result;
}
async function deck(extra = "") {
  const map = parts(
    await createPresentation(
      { slides: [{ name: "One" }, { name: "Two" }, { name: "Three" }] },
      context
    )
  );
  if (extra) {
    const xml = parseXmlPart(map.get("ppt/presentation.xml")!, context.xmlLimits);
    map.set(
      "ppt/presentation.xml",
      xml.spliceChildren(xml.root, xml.root.children.length, 0, [extra]).bytes()
    );
  }
  const slide = parseXmlPart(map.get("ppt/slides/slide2.xml")!, context.xmlLimits);
  map.set(
    "ppt/slides/slide2.xml",
    slide
      .merge(slide.root, { attributes: [{ namespace: "", localName: "show", value: "0" }] })
      .bytes()
  );
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "store" }
  );
}
describe("presentation membership editing", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      delay?: number
    ) => (delay === 0 ? setImmediate(callback) : timer(callback, delay))) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it.each(["sections", "shows"] as const)(
    "creates, renames, moves and removes %s with persistent identities",
    async (kind) => {
      let bytes = await deck();
      expect(await readMemberships(bytes, kind, context)).toEqual([]);
      bytes = await mutateMemberships(
        bytes,
        kind,
        { action: "add", name: "", slides: [1, 2] },
        context
      );
      const first = (await readMemberships(bytes, kind, context))[0]!;
      expect(first).toMatchObject({ name: "", position: 1, slides: [1, 2] });
      expect(attributes(bytes, kind === "sections" ? "section" : "custShow")[0]).toMatchObject({
        id: first.id,
        name: ""
      });
      bytes = await mutateMemberships(
        bytes,
        kind,
        { action: "add", name: "", slides: [3] },
        context
      );
      bytes = await mutateMemberships(
        bytes,
        kind,
        { action: "set", selection: { id: first.id }, name: "A & B", position: 2 },
        context
      );
      expect(await readMemberships(bytes, kind, context)).toEqual([
        expect.objectContaining({ name: "", slides: [3] }),
        { ...first, name: "A & B", position: 2 }
      ]);
      bytes = await mutateMemberships(
        bytes,
        kind,
        { action: "remove", selection: { id: first.id } },
        context
      );
      expect((await readMemberships(bytes, kind, context)).map((x) => x.slides)).toEqual([[3]]);
      bytes = await mutateMemberships(
        bytes,
        kind,
        { action: "remove", selection: { all: true } },
        context
      );
      expect(await readMemberships(bytes, kind, context)).toEqual([]);
    }
  );
  it.each(["sections", "shows"] as const)(
    "validates %s membership and selections",
    async (kind) => {
      const bytes = await mutateMemberships(
        await deck(),
        kind,
        { action: "add", name: "Same", slides: [1] },
        context
      );
      for (const slides of [[], [1, 1], [0], [4], [1.2]])
        await expect(
          mutateMemberships(bytes, kind, { action: "add", name: "Other", slides }, context)
        ).rejects.toMatchObject({ code: "invalid-value" });
      const duplicate = await mutateMemberships(
        bytes,
        kind,
        { action: "add", name: "Same", slides: [2] },
        context
      );
      await expect(
        mutateMemberships(
          duplicate,
          kind,
          { action: "set", selection: { name: "Same" }, name: "Renamed" },
          context
        )
      ).rejects.toMatchObject({ code: "ambiguous-selection" });
      await expect(
        mutateMemberships(bytes, kind, { action: "remove", selection: { id: "missing" } }, context)
      ).rejects.toMatchObject({ code: "missing-selection" });
      expect(
        await mutateMemberships(
          bytes,
          kind,
          { action: "remove", selection: { id: "missing" }, allowEmpty: true },
          context
        )
      ).toEqual(bytes);
    }
  );
  it("rejects noncontiguous and overlapping sections", async () => {
    const bytes = await mutateMemberships(
      await deck(),
      "sections",
      { action: "add", name: "A", slides: [1, 2] },
      context
    );
    for (const slides of [
      [1, 3],
      [3, 2],
      [2, 3]
    ])
      await expect(
        mutateMemberships(bytes, "sections", { action: "add", name: "B", slides }, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("preserves repeated existing show entries and opaque extensions when renaming", async () => {
    const ext = '<x:metadata xmlns:x="urn:deck:test" value="keep"/>';
    const bytes = await deck(
      `<p:custShowLst xmlns:p="${p}" xmlns:r="${r}"><p:custShow name="Old" id="8"><p:sldLst><p:sld r:id="rId3"/><p:sld r:id="rId3"/></p:sldLst><p:extLst><p:ext uri="urn:deck:test">${ext}</p:ext></p:extLst></p:custShow></p:custShowLst>`
    );
    const changed = await mutateMemberships(
      bytes,
      "shows",
      { action: "set", selection: { id: "8" }, name: "New" },
      context
    );
    expect(await readMemberships(changed, "shows", context)).toEqual([
      { id: "8", name: "New", position: 1, slides: [2, 2] }
    ]);
    expect(new TextDecoder().decode(parts(changed).get("ppt/presentation.xml"))).toContain(ext);
    expect(attributes(changed, "sld").map((x) => x["r:id"])).toEqual(["rId3", "rId3"]);
  });
  it("rejects unsupported section structures without mutating source", async () => {
    const bytes = await deck(
      `<p:extLst xmlns:p="${p}"><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><s:sectionLst xmlns:s="${s}"><s:section name="A" id="{00000000-0000-0000-0000-000000000001}"><s:sldIdLst><s:sldId id="256"/></s:sldIdLst><s:future/></s:section></s:sectionLst></p:ext></p:extLst>`
    );
    await expect(
      mutateMemberships(
        bytes,
        "sections",
        { action: "set", selection: { position: 1 }, slides: [2] },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("preserves custom show order and unrelated parts", async () => {
    const bytes = await deck();
    const changed = await mutateMemberships(
      bytes,
      "shows",
      { action: "add", name: "Reverse", slides: [3, 1] },
      context
    );
    expect((await readMemberships(changed, "shows", context))[0]!.slides).toEqual([3, 1]);
    for (const [name, value] of parts(bytes))
      if (name !== "ppt/presentation.xml") expect(parts(changed).get(name)).toEqual(value);
  });
  it.each(["nonnumeric", "4294967296", "-1", "1.5"])(
    "rejects invalid stored show identity %s",
    async (id) => {
      const bytes = await deck(
        `<p:custShowLst xmlns:p="${p}" xmlns:r="${r}"><p:custShow name="A" id="${id}"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst>`
      );
      await expect(readMemberships(bytes, "shows", context)).rejects.toMatchObject({
        code: "invalid-opc"
      });
    }
  );
  it("rejects numeric identity aliases and malformed section identities", async () => {
    const shows = await deck(
      `<p:custShowLst xmlns:p="${p}" xmlns:r="${r}"><p:custShow name="A" id="01"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow><p:custShow name="B" id="1"><p:sldLst><p:sld r:id="rId3"/></p:sldLst></p:custShow></p:custShowLst>`
    );
    await expect(readMemberships(shows, "shows", context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
    const sections = await deck(
      `<p:extLst xmlns:p="${p}"><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><s:sectionLst xmlns:s="${s}"><s:section name="A" id="bad"><s:sldIdLst><s:sldId id="256"/></s:sldIdLst></s:section></s:sectionLst></p:ext></p:extLst>`
    );
    await expect(readMemberships(sections, "sections", context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it("removes empty section wrappers", async () => {
    const bytes = await mutateMemberships(
      await deck(),
      "sections",
      { action: "add", name: "A", slides: [1] },
      context
    );
    const changed = await mutateMemberships(
      bytes,
      "sections",
      { action: "remove", selection: { all: true } },
      context
    );
    expect(attributes(changed, "extLst")).toEqual([]);
  });
  it.each(["sections", "shows"] as const)(
    "replaces %s membership while retaining the stable identity",
    async (kind) => {
      const bytes = await mutateMemberships(
        await deck(),
        kind,
        { action: "add", name: "A", slides: [1] },
        context
      );
      const first = (await readMemberships(bytes, kind, context))[0]!;
      const changed = await mutateMemberships(
        bytes,
        kind,
        { action: "set", selection: { id: first.id }, slides: [2, 3] },
        context
      );
      expect(await readMemberships(changed, kind, context)).toEqual([{ ...first, slides: [2, 3] }]);
      expect(
        attributes(changed, kind === "shows" ? "sld" : "sldId")
          .slice(kind === "shows" ? 0 : 3)
          .map((a) => a[kind === "shows" ? "r:id" : "id"])
      ).toEqual(kind === "shows" ? ["rId3", "rId4"] : ["257", "258"]);
    }
  );
  it("validates invalid updates even when missing selection is allowed", async () => {
    const bytes = await deck();
    for (const update of [
      { slides: [] },
      { slides: [NaN] },
      { name: "bad\u0000" },
      { position: 100 }
    ])
      await expect(
        mutateMemberships(
          bytes,
          "shows",
          { action: "set", selection: { id: "missing" }, allowEmpty: true, ...update },
          context
        )
      ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("moves an explicit identity subset as one ordered block", async () => {
    let bytes = await deck();
    for (const name of ["A", "B", "C"])
      bytes = await mutateMemberships(
        bytes,
        "shows",
        { action: "add", name, slides: [1] },
        context
      );
    const records = await readMemberships(bytes, "shows", context);
    const changed = await mutateMemberships(
      bytes,
      "shows",
      {
        action: "set",
        selection: { ids: [records[0]!.id, records[2]!.id], all: true },
        position: 2
      },
      context
    );
    expect((await readMemberships(changed, "shows", context)).map((x) => x.name)).toEqual([
      "B",
      "A",
      "C"
    ]);
  });
  it("rejects additional unrecognized section lists beside a supported list", async () => {
    const bytes = await deck(
      `<p:extLst xmlns:p="${p}"><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><s:sectionLst xmlns:s="${s}"><s:section name="A" id="{00000000-0000-0000-0000-000000000001}"><s:sldIdLst><s:sldId id="256"/></s:sldIdLst></s:section></s:sectionLst></p:ext><p:ext uri="urn:unknown-sections"><x:sectionLst xmlns:x="urn:unknown-sections"/></p:ext></p:extLst>`
    );
    await expect(readMemberships(bytes, "sections", context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
  });
  it("allocates show IDs without colliding with numeric lexical aliases", async () => {
    const source = await deck(
      `<p:custShowLst xmlns:p="${p}" xmlns:r="${r}"><p:custShow name="A" id="00"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst>`
    );
    const changed = await mutateMemberships(
      source,
      "shows",
      { action: "add", name: "B", slides: [2] },
      context
    );
    expect((await readMemberships(changed, "shows", context)).map((x) => x.id)).toEqual([
      "00",
      "1"
    ]);
  });
  it.each(["sections", "shows"] as const)(
    "returns the original archive for unchanged %s names",
    async (kind) => {
      const source = await mutateMemberships(
        await deck(),
        kind,
        { action: "add", name: "A", slides: [1] },
        context
      );
      const changed = await mutateMemberships(
        source,
        kind,
        { action: "set", selection: { position: 1 }, name: "A" },
        context
      );
      expect(changed).toEqual(source);
    }
  );
  it("preserves unrelated presentation extensions through section edits and removal", async () => {
    const opaque = '<x:metadata xmlns:x="urn:deck:metadata" keep="yes"/>';
    let source = await deck(
      `<p:extLst xmlns:p="${p}"><p:ext uri="urn:deck:metadata">${opaque}</p:ext></p:extLst>`
    );
    source = await mutateMemberships(
      source,
      "sections",
      { action: "add", name: "A", slides: [1] },
      context
    );
    source = await mutateMemberships(
      source,
      "sections",
      { action: "set", selection: { position: 1 }, name: "B", slides: [2, 3] },
      context
    );
    const changed = await mutateMemberships(
      source,
      "sections",
      { action: "remove", selection: { position: 1 } },
      context
    );
    expect(attributes(changed, "ext").map((x) => x.uri)).toEqual(["urn:deck:metadata"]);
    expect(new TextDecoder().decode(parts(changed).get("ppt/presentation.xml"))).toContain(opaque);
  });
  it.each(["settings", "action", "unknown-action"])(
    "refuses deleting a custom show with a live %s reference",
    async (reference) => {
      const original = await mutateMemberships(
        await deck(),
        "shows",
        { action: "add", name: "A", slides: [1] },
        context
      );
      const map = parts(original);
      const name = reference === "settings" ? "ppt/presentation.xml" : "ppt/slides/slide1.xml";
      const xml = parseXmlPart(map.get(name)!, context.xmlLimits);
      const fragment =
        reference === "settings"
          ? `<p:showPr xmlns:p="${p}"><p:custShow id="0"/></p:showPr>`
          : `<a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" action="ppaction://customshow?${reference === "action" ? "id=0&amp;return=true" : "name=unknown"}"/>`;
      map.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [fragment]).bytes());
      const bytes = await writePackageArchive(
        [...map].map(([name, bytes]) => ({ name, bytes })),
        context,
        { compression: "store" }
      );
      await expect(
        mutateMemberships(
          bytes,
          "shows",
          { action: "remove", selection: { id: "0" } },
          context
        ).then(() => "published")
      ).rejects.toMatchObject({ code: "dangling-reference" });
      const renamed = await mutateMemberships(
        bytes,
        "shows",
        { action: "set", selection: { id: "0" }, name: "B" },
        context
      );
      expect((await readMemberships(renamed, "shows", context))[0]!.name).toBe("B");
    }
  );
});
