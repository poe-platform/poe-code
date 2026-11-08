import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import {
  createPresentation,
  mutateSlides,
  readSelectionIndex,
  type SelectionQuery
} from "./index.js";
import { writePackageArchive } from "./package-writer.js";
import { inspectZip } from "../tests/zip-reader.js";
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
const enc = new TextEncoder();
const dec = new TextDecoder();
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
}
function attrs(bytes: Uint8Array, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value])));
  });
  parser.write(dec.decode(bytes)).close();
  return result;
}
const selection = (value: number): SelectionQuery => ({
  kind: "slide",
  position: { coordinateSystem: "one-based", value }
});
async function fixture(show?: string) {
  const map = parts(
    await createPresentation(
      { slides: ["Shared", "", "Shared", "Last"].map((name) => ({ name })) },
      context
    )
  );
  const edit = (
    name: string,
    fn: (xml: ReturnType<typeof parseXmlPart>) => ReturnType<typeof parseXmlPart>
  ) => map.set(name, fn(parseXmlPart(map.get(name)!, context.xmlLimits)).bytes());
  edit("ppt/presentation.xml", (xml) => {
    const list = xml.root.children.find((x) => x.name.localName === "sldIdLst")!;
    xml = xml.spliceChildren(list, 0, 4, [
      `<p:sldId xmlns:p="${p}" xmlns:r="${r}" xmlns:custom="urn:custom" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="custom" custom:tag="keep" id="900" r:id="rId4"/>`,
      `<p:sldId xmlns:p="${p}" xmlns:r="${r}" id="256" r:id="rId2"/>`,
      `<p:sldId xmlns:p="${p}" xmlns:r="${r}" id="720" r:id="rId5"/>`,
      `<p:sldId xmlns:p="${p}" xmlns:r="${r}" id="2147483647" r:id="rId3"/>`
    ]);
    return xml;
  });
  edit("ppt/slides/slide3.xml", (xml) =>
    xml.merge(xml.root, { attributes: [{ namespace: "", localName: "show", value: "false" }] })
  );
  edit("ppt/slides/slide1.xml", (xml) =>
    xml.spliceChildren(xml.root, xml.root.children.length, 0, [
      `<p:timing xmlns:p="${p}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite"/></p:par></p:tnLst></p:timing>`
    ])
  );
  if (show !== undefined)
    edit("ppt/slides/slide1.xml", (xml) =>
      xml.merge(xml.root, { attributes: [{ namespace: "", localName: "show", value: show }] })
    );
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  edit("ppt/slides/_rels/slide1.xml.rels", (xml) =>
    xml.spliceChildren(xml.root, 1, 0, [
      `<Relationship xmlns="${rel}" Id="link" Type="${r}/slide" Target="slide3.xml"/>`,
      `<Relationship xmlns="${rel}" Id="web" Type="${r}/hyperlink" Target="https://example.invalid/guide" TargetMode="External"/>`,
      `<Relationship xmlns="${rel}" Id="note" Type="${r}/notesSlide" Target="../notesSlides/note.xml"/>`
    ])
  );
  const tree =
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
  map.set(
    "ppt/notesSlides/note.xml",
    enc.encode(
      `<p:notes xmlns:p="${p}"><p:cSld name="Remember the tide">${tree}</p:cSld></p:notes>`
    )
  );
  map.set(
    "ppt/notesMasters/master.xml",
    enc.encode(`<p:notesMaster xmlns:p="${p}"><p:cSld>${tree}</p:cSld><p:clrMap/></p:notesMaster>`)
  );
  map.set(
    "ppt/notesSlides/_rels/note.xml.rels",
    enc.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="slide" Type="${r}/slide" Target="../slides/slide1.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/master.xml"/></Relationships>`
    )
  );
  edit("[Content_Types].xml", (xml) =>
    xml.spliceChildren(xml.root, xml.root.children.length, 0, [
      '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/notesSlides/note.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>',
      '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/notesMasters/master.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
    ])
  );
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "store" }
  );
}

describe("slide order and visibility", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      delay?: number
    ) => (delay === 0 ? setImmediate(callback) : timer(callback, delay))) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it.each([0, 1, 2])(
    "inspects %s slides in list order with exact lookup and bounds",
    async (count) => {
      const source = await createPresentation(
        { slides: Array.from({ length: count }, (_, i) => ({ name: `Page ${i}` })) },
        context
      );
      const index = await readSelectionIndex(source, context);
      expect(index.slides.length).toBe(count);
      expect([...index.slides].map((slide) => slide.id)).toEqual(["256", "257"].slice(0, count));
      for (let i = 0; i < count; i++) {
        const selected = index.select({
          kind: "slide",
          position: { coordinateSystem: "zero-based", value: i }
        });
        expect(selected[0]).toMatchObject({
          id: String(256 + i),
          position: i + 1,
          name: `Page ${i}`
        });
        expect(index.select({ kind: "slide", id: String(256 + i) })[0]).toBe(selected[0]);
      }
      expect(() => index.select({ kind: "slide", id: "666" })).toThrowError(
        expect.objectContaining({ code: "missing-selection" })
      );
      expect(() =>
        index.select({ kind: "slide", position: { coordinateSystem: "zero-based", value: 2 } })
      ).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    }
  );
  it.each([
    [[4, 2], 1, ["2147483647", "256", "900", "720"]],
    [[3, 1], 3, ["256", "2147483647", "720", "900"]],
    [[1], 4, ["256", "720", "2147483647", "900"]],
    [[4, 3, 2, 1], 1, ["2147483647", "720", "256", "900"]]
  ] as const)(
    "moves requested positions %j to final position %s with stable identities",
    async (positions, position, ids) => {
      const source = await fixture();
      const output = await mutateSlides(
        source,
        { selection: positions.map(selection), position },
        context
      );
      const before = parts(source),
        after = parts(output);
      expect(attrs(after.get("ppt/presentation.xml")!, "sldId").map((x) => x.id)).toEqual(ids);
      expect(after.size).toBe(before.size);
      for (const [name, bytes] of before)
        if (name !== "ppt/presentation.xml") expect(after.get(name), name).toEqual(bytes);
      expect(
        attrs(after.get("ppt/presentation.xml")!, "sldId").find((x) => x.id === "900")
      ).toEqual(attrs(before.get("ppt/presentation.xml")!, "sldId")[0]);
      expect((await readSelectionIndex(output, context)).slides.map((x) => x.id)).toEqual(ids);
      expect(
        (await readSelectionIndex(output, context)).inventory.slides.find((x) => x.id === "900")
      ).toMatchObject({ show: { effective: false, explicit: false } });
    }
  );

  it.each([true, false])(
    "changes hidden=%s on a selected slide without altering its contents",
    async (hidden) => {
      const source = await fixture(hidden ? "1" : "0");
      const output = await mutateSlides(source, { selection: selection(2), hidden }, context);
      const before = parts(source),
        after = parts(output);
      expect(attrs(after.get("ppt/slides/slide1.xml")!, "sld")[0]!.show).toBe(hidden ? "0" : "1");
      for (const [name, bytes] of before)
        if (name !== "ppt/slides/slide1.xml") expect(after.get(name), name).toEqual(bytes);
      const original = dec.decode(before.get("ppt/slides/slide1.xml"));
      const changed = dec.decode(after.get("ppt/slides/slide1.xml"));
      expect(changed.slice(changed.indexOf("><p:cSld"))).toBe(
        original.slice(original.indexOf("><p:cSld"))
      );
    }
  );

  it.each([
    [undefined, "Fresh"],
    ["Fresh", "Next"],
    ["Next", ""],
    [undefined, ""]
  ] as const)("sets a label from %s to %s", async (initial, name) => {
    let source = await createPresentation(
      { slides: [initial === undefined ? {} : { name: initial }] },
      context
    );
    if (initial === undefined) {
      const map = parts(source);
      const xml = parseXmlPart(map.get("ppt/slides/slide1.xml")!, context.xmlLimits);
      map.set(
        "ppt/slides/slide1.xml",
        xml
          .merge(xml.root.children[0]!, {
            attributes: [{ namespace: "", localName: "name", value: null }]
          })
          .bytes()
      );
      source = await writePackageArchive(
        [...map].map(([name, bytes]) => ({ name, bytes })),
        context,
        { compression: "store" }
      );
    }
    expect((await readSelectionIndex(source, context)).slides[0]!.name).toBe(initial ?? "");
    source = await mutateSlides(source, { selection: selection(1), name }, context);
    expect((await readSelectionIndex(source, context)).slides[0]!.name).toBe(name);
    expect(attrs(parts(source).get("ppt/slides/slide1.xml")!, "cSld")[0]!.name).toBe(
      name || undefined
    );
  });

  it("treats duplicate names as labels and requires explicit bulk selection", async () => {
    const source = await fixture();
    await expect(
      mutateSlides(source, { selection: { kind: "slide", name: "Shared" }, hidden: true }, context)
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    const output = await mutateSlides(
      source,
      { selection: { kind: "slide", name: "Shared", all: true }, name: "Same", hidden: true },
      context
    );
    expect((await readSelectionIndex(output, context)).slides.map((x) => [x.id, x.name])).toEqual([
      ["900", "Same"],
      ["256", "Same"],
      ["720", "Last"],
      ["2147483647", ""]
    ]);
  });

  it("retains original bytes for no-op order, name and effective visibility", async () => {
    const source = await fixture();
    for (const options of [{ position: 1 }, { hidden: true }, { name: "Shared" }])
      expect(await mutateSlides(source, { selection: selection(1), ...options }, context)).toEqual(
        source
      );
  });

  it("rejects duplicates and stale or foreign selections before producing bytes", async () => {
    const source = await fixture();
    await expect(
      mutateSlides(source, { selection: [selection(1), selection(1)], position: 2 }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
    const index = await readSelectionIndex(source, context);
    const moved = await mutateSlides(source, { selection: selection(1), position: 2 }, context);
    await expect(
      mutateSlides(moved, { selection: { token: index.slides[0]!.token }, hidden: false }, context)
    ).rejects.toMatchObject({ code: "stale-selection" });
    await expect(
      mutateSlides(
        source,
        { selection: { kind: "part", scope: "notes", all: true }, hidden: false },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-selection" });
  });

  it.each([0, 4, 1.5, NaN])("rejects invalid block destination %s", async (position) => {
    await expect(
      mutateSlides(await fixture(), { selection: [selection(1), selection(3)], position }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });

  it("requires fields and explicit selection even with empty-match permission", async () => {
    const source = await fixture();
    await expect(
      mutateSlides(source, { selection: selection(1), allowEmpty: true }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    await expect(
      mutateSlides(source, { selection: { kind: "slide" }, hidden: true }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
    await expect(
      mutateSlides(source, { selection: selection(9), hidden: true }, context)
    ).rejects.toMatchObject({ code: "missing-selection" });
    expect(
      await mutateSlides(
        source,
        { selection: selection(9), hidden: true, allowEmpty: true },
        context
      )
    ).toEqual(source);
    await expect(
      mutateSlides(source, { selection: selection(1), name: null as unknown as string }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });

  it.each([undefined, "Existing"])("rejects null labels from initial %s", async (name) => {
    const source = await createPresentation(
      { slides: [name === undefined ? {} : { name }] },
      context
    );
    await expect(
      mutateSlides(source, { selection: selection(1), name: null as unknown as string }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });

  it("rejects out-of-scope empty queries despite empty-match permission", async () => {
    await expect(
      mutateSlides(
        await fixture(),
        {
          selection: { kind: "part", scope: "notes", name: "/missing.xml" },
          hidden: true,
          allowEmpty: true
        },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-selection" });
  });

  it.each(["protection", "macro", "invalid-show"])(
    "rejects unsafe edit intent %s",
    async (kind) => {
      const map = parts(await fixture());
      const part =
        kind === "protection"
          ? "ppt/presentation.xml"
          : kind === "macro"
            ? "[Content_Types].xml"
            : "ppt/slides/slide3.xml";
      let xml = parseXmlPart(map.get(part)!, context.xmlLimits);
      if (kind === "protection")
        xml = xml.spliceChildren(xml.root, xml.root.children.length, 0, [
          `<p:modifyVerifier xmlns:p="${p}"/>`
        ]);
      else if (kind === "macro") {
        const entry = xml.root.children.find((node) =>
          node.attributes.some(
            (a) => a.name.localName === "PartName" && a.value === "/ppt/presentation.xml"
          )
        )!;
        xml = xml.merge(entry, {
          attributes: [
            {
              namespace: "",
              localName: "ContentType",
              value: "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"
            }
          ]
        });
      } else
        xml = xml.merge(xml.root, {
          attributes: [{ namespace: "", localName: "show", value: "maybe" }]
        });
      map.set(part, xml.bytes());
      const input = await writePackageArchive(
        [...map].map(([name, bytes]) => ({ name, bytes })),
        context,
        { compression: "store" }
      );
      await expect(
        mutateSlides(input, { selection: selection(1), hidden: true }, context)
      ).rejects.toMatchObject({
        code: kind === "invalid-show" ? "invalid-xml" : "unsupported-edit"
      });
    }
  );
});
