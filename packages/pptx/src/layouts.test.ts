import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { addSlide } from "./slides.js";
import { addLayout, applyLayout, mutateLayout, readLayouts, removeLayout } from "./layouts.js";
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
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms?: number) =>
    ms === 0 ? setImmediate(cb) : timer(cb, ms)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function parts(bytes: Uint8Array) {
  const v = Volume.fromJSON({});
  v.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(v.readFileSync("/deck") as Buffer)).map((x) => [
      x.name,
      new TextDecoder().decode(x.payload)
    ])
  );
}
function attrs(xml: string, local: string) {
  const out: Record<string, string>[] = [];
  const p = new SaxesParser({ xmlns: true });
  p.on("opentag", (t) => {
    if (t.local === local)
      out.push(Object.fromEntries(Object.values(t.attributes).map((a) => [a.name, a.value])));
  });
  p.write(xml).close();
  return out;
}
describe("layout identities and placeholder policies", () => {
  it("creates registered layout IDs and edits supported properties without touching slides", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    const added = await addLayout(
      source,
      {
        scope: "layouts",
        master: "Original master",
        name: "Article",
        type: "obj",
        preserve: true,
        showMasterShapes: false,
        matchingName: "article",
        placeholders: [{ name: "Content", text: "Prompt" }]
      },
      context
    );
    const data = await readLayouts(added.bytes, context);
    expect(data.map((x) => x.id)).toEqual(["2147483649", "2147483650"]);
    expect(data[1]).toMatchObject({
      name: "Article",
      master: "/ppt/slideMasters/slideMaster1.xml",
      type: "obj",
      preserve: true,
      showMasterShapes: false,
      matchingName: "article",
      placeholders: [{ type: "obj", index: 0 }]
    });
    const edited = await mutateLayout(
      added.bytes,
      {
        scope: "layouts",
        layout: "Article",
        name: "New",
        preserve: false,
        text: "New prompt",
        shape: "Content"
      },
      context
    );
    expect(parts(edited.bytes).get("ppt/slides/slide1.xml")).toBe(
      parts(source).get("ppt/slides/slide1.xml")
    );
    expect(parts(edited.bytes).get(added.part.slice(1))).toContain("New prompt");
    expect((await readLayouts(edited.bytes, context))[1]).toMatchObject({
      name: "New",
      preserve: false
    });
    const removed = await removeLayout(edited.bytes, { scope: "layouts", layout: "New" }, context);
    expect(parts(removed.bytes).has(added.part.slice(1))).toBe(false);
    expect(
      attrs(parts(removed.bytes).get("ppt/slideMasters/slideMaster1.xml")!, "sldLayoutId")
    ).toHaveLength(1);
    await expect(
      removeLayout(source, { scope: "layouts", layout: "Blank" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("applies matching omitted placeholder defaults by relationship while retaining all local XML", async () => {
    let bytes = await createPresentation({}, context);
    bytes = (
      await addLayout(
        bytes,
        {
          scope: "layouts",
          master: "Original master",
          name: "One",
          placeholders: [{ name: "Copy" }]
        },
        context
      )
    ).bytes;
    bytes = await addSlide(
      bytes,
      { layout: "One", placeholders: [{ type: "obj", text: "Retain local words" }] },
      context
    );
    const target = await addLayout(
      bytes,
      {
        scope: "layouts",
        master: "Original master",
        name: "Two",
        placeholders: [{ type: "obj", index: 0, x: 9, y: 8, width: 50, height: 60 }]
      },
      context
    );
    const result = await applyLayout(
      target.bytes,
      {
        selection: { kind: "slide", all: true },
        layout: "Two",
        placeholderPolicy: "reject-unmatched"
      },
      context
    );
    expect(result.affectedSlides).toEqual([1]);
    expect(parts(result.bytes).get("ppt/slides/slide1.xml")).toBe(
      parts(target.bytes).get("ppt/slides/slide1.xml")
    );
    expect(
      attrs(parts(result.bytes).get("ppt/slides/_rels/slide1.xml.rels")!, "Relationship")[0]!.Target
    ).toBe("../slideLayouts/slideLayout3.xml");
    await expect(
      applyLayout(
        target.bytes,
        {
          selection: { kind: "slide", all: true },
          layout: "Blank",
          placeholderPolicy: "reject-unmatched"
        },
        context
      )
    ).rejects.toMatchObject({ code: "missing-selection" });
    const kept = await applyLayout(
      target.bytes,
      { selection: { kind: "slide", all: true }, layout: "Blank", placeholderPolicy: "type-index" },
      context
    );
    expect(parts(kept.bytes).get("ppt/slides/slide1.xml")).toBe(
      parts(target.bytes).get("ppt/slides/slide1.xml")
    );
  });
  it("rejects duplicate sparse indices and missing explicit mutation scope", async () => {
    const bytes = await createPresentation({}, context);
    await expect(
      addLayout(
        bytes,
        {
          scope: "layouts",
          master: "Original master",
          name: "Duplicate",
          placeholders: [
            { type: "title", index: 4 },
            { type: "body", index: 4 }
          ]
        },
        context
      )
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    await expect(
      mutateLayout(bytes, { layout: "Blank", name: "New" } as never, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("authors complete coordinate pairs and rejects rich placeholder text coercion", async () => {
    const bytes = await createPresentation({}, context);
    const created = await addLayout(
      bytes,
      {
        scope: "layouts",
        master: "Original master",
        name: "Paired",
        placeholders: [{ x: 12, width: 56 }]
      },
      context
    );
    const xml = parts(created.bytes).get(created.part.slice(1))!;
    expect(attrs(xml, "off")).toEqual([{ x: "12", y: "0" }]);
    expect(attrs(xml, "ext")).toEqual([{ cx: "56", cy: "0" }]);
    await expect(
      addLayout(
        bytes,
        {
          scope: "layouts",
          master: "Original master",
          name: "Rich",
          placeholders: [{ type: "tbl", text: "Coercion" }]
        },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
});
