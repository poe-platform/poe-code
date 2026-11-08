import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";
import { SaxesParser } from "saxes";
import { mutateNotes, readNotes } from "./notes.js";
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
function entries(bytes: Uint8Array): Map<string, Uint8Array> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((e) => [
      e.name,
      e.payload
    ])
  );
}
describe("speaker notes", () => {
  it("reads absence without creating any notes", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    expect(await readNotes(source, {}, context)).toEqual([]);
    expect([...entries(source).keys()].some((name) => name.includes("notes"))).toBe(false);
  });
  it("creates associated notes with three distinct placeholders and edits only speaker text", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    const added = await mutateNotes(
      source,
      "add",
      { selection, text: "Opening & context\nNext\vPause" },
      context
    );
    const records = await readNotes(added.bytes, {}, context);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      slide: 1,
      text: "Opening & context\nNext\vPause",
      bodyShapeId: "3",
      master: "/ppt/notesMasters/notesMaster1.xml"
    });
    const xml = new TextDecoder().decode(
      entries(added.bytes).get("ppt/notesSlides/notesSlide1.xml")
    );
    expect(xml).toContain('type="sldImg"');
    expect(xml).toContain('type="body"');
    expect(xml).toContain('type="sldNum"');
    await expect(
      mutateNotes(added.bytes, "add", { selection, text: "Duplicate" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    const updated = await mutateNotes(added.bytes, "set", { selection, text: "Updated" }, context);
    expect((await readNotes(updated.bytes, {}, context))[0]?.text).toBe("Updated");
    expect(entries(updated.bytes).get("ppt/notesMasters/notesMaster1.xml")).toEqual(
      entries(added.bytes).get("ppt/notesMasters/notesMaster1.xml")
    );
    const removed = await mutateNotes(updated.bytes, "remove", { selection }, context);
    expect(await readNotes(removed.bytes, {}, context)).toEqual([]);
    expect(entries(removed.bytes).has("ppt/notesSlides/notesSlide1.xml")).toBe(false);
    expect(entries(removed.bytes).has("ppt/notesMasters/notesMaster1.xml")).toBe(true);
  });
});

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
async function authoredNotes(markup: string, masterMarkup = "") {
  const source = await mutateNotes(
    await createPresentation({ slides: [{}] }, context),
    "add",
    { selection, text: "Original" },
    context
  );
  const map = entries(source.bytes);
  const part = "ppt/notesSlides/notesSlide1.xml";
  const doc = parseXmlPart(map.get(part)!, context.xmlLimits);
  const tree = doc.root.children[0]!.children[0]!;
  const wrapper = parseXmlPart(
    new TextEncoder().encode(`<root>${markup}</root>`),
    context.xmlLimits
  );
  map.set(
    part,
    doc
      .spliceChildren(
        tree,
        2,
        tree.children.length - 2,
        wrapper.root.children.map((n) => wrapper.markup(n, true))
      )
      .bytes()
  );
  if (masterMarkup) {
    const name = "ppt/notesMasters/notesMaster1.xml";
    const master = parseXmlPart(map.get(name)!, context.xmlLimits);
    const tree = master.root.children[0]!.children[0]!;
    map.set(name, master.spliceChildren(tree, tree.children.length, 0, [masterMarkup]).bytes());
  }
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "auto" }
  );
}
function ph(id: number, type: string, text: string, extra = "") {
  return `<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="${id}" name="Note ${id}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p>${extra}</p:txBody></p:sp>`;
}
describe("notes preservation boundaries", () => {
  it.each(["sldImg", "sldNum", "dt", "hdr", "ftr"])(
    "excludes %s text from an empty speaker body",
    async (type) => {
      const input = await authoredNotes(ph(2, type, "Not speaker text") + ph(3, "body", ""));
      expect((await readNotes(input, {}, context))[0]?.text).toBe("");
      const changed = await mutateNotes(input, "set", { selection, text: "Speaker only" }, context);
      const xml = new TextDecoder().decode(
        entries(changed.bytes).get("ppt/notesSlides/notesSlide1.xml")
      );
      expect(xml).toContain(ph(2, type, "Not speaker text"));
    }
  );
  it("reports no body as null then appends speaker text without disturbing unrelated content", async () => {
    const foreign = `<p:extLst xmlns:p="${p}"><p:ext uri="keep"><x:opaque xmlns:x="urn:notes-extension"/></p:ext></p:extLst>`;
    const input = await authoredNotes(ph(8, "ftr", "Footer") + foreign);
    expect((await readNotes(input, {}, context))[0]).toMatchObject({
      text: null,
      bodyShapeId: null
    });
    const changed = await mutateNotes(input, "set", { selection, text: "New body" }, context);
    expect((await readNotes(changed.bytes, {}, context))[0]).toMatchObject({
      text: "New body",
      bodyShapeId: "9"
    });
    const xml = new TextDecoder().decode(
      entries(changed.bytes).get("ppt/notesSlides/notesSlide1.xml")
    );
    expect(xml).toContain(foreign);
    expect(xml).toContain(ph(8, "ftr", "Footer"));
  });
  it("preserves unsupported siblings of speaker paragraphs", async () => {
    const extension = `<a:extLst xmlns:a="${a}"><a:ext uri="retain"><x:custom xmlns:x="urn:notes-extension"/></a:ext></a:extLst>`;
    const input = await authoredNotes(ph(3, "body", "Old", extension));
    const changed = await mutateNotes(input, "set", { selection, text: "Changed" }, context);
    expect(
      new TextDecoder().decode(entries(changed.bytes).get("ppt/notesSlides/notesSlide1.xml"))
    ).toContain(extension);
  });
  it("rejects destructive edits over unsupported inline content", async () => {
    const input = await authoredNotes(
      `<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="3" name="Speaker"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:extLst><a:ext uri="opaque"><x:custom xmlns:x="urn:notes-extension"/></a:ext></a:extLst></a:p></p:txBody></p:sp>`
    );
    await expect(
      mutateNotes(input, "set", { selection, text: "Replacement" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it.each(["", "Plain", "One\nTwo", "Pause\vResume", "<&>\t\r"])(
    "round-trips authored speaker text %j",
    async (text) => {
      const changed = await mutateNotes(
        await createPresentation({ slides: [{}] }, context),
        "set",
        { selection, text },
        context
      );
      expect((await readNotes(changed.bytes, {}, context))[0]?.text).toBe(text);
      const parser = new SaxesParser({ xmlns: true });
      const observed: string[] = [];
      let capture = false;
      parser.on("opentag", (tag) => {
        capture = tag.uri === a && tag.local === "t";
      });
      parser.on("text", (value) => {
        if (capture) observed.push(value);
      });
      parser.on("closetag", () => {
        capture = false;
      });
      parser
        .write(
          new TextDecoder().decode(entries(changed.bytes).get("ppt/notesSlides/notesSlide1.xml"))
        )
        .close();
      expect(observed.join("")).toBe(text.split("\n").join("").split("\v").join(""));
    }
  );
});

it("clones only image, speaker and number placeholders with cleared master text", async () => {
  let source = await authoredNotes(ph(3, "body", "Existing"));
  const map = entries(source);
  const name = "ppt/notesMasters/notesMaster1.xml";
  const doc = parseXmlPart(map.get(name)!, context.xmlLimits);
  const tree = doc.root.children[0]!.children[0]!;
  const shapes = [
    ph(20, "sldImg", "Master image"),
    ph(21, "body", "Master body"),
    ph(22, "sldNum", "Master number"),
    ph(23, "dt", "Master date"),
    ph(24, "ftr", "Master footer")
  ];
  map.set(name, doc.spliceChildren(tree, 2, tree.children.length - 2, shapes).bytes());
  source = await writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "auto" }
  );
  source = (await mutateNotes(source, "remove", { selection }, context)).bytes;
  const result = await mutateNotes(source, "add", { selection, text: "New speaker" }, context);
  const xml = new TextDecoder().decode(
    entries(result.bytes).get("ppt/notesSlides/notesSlide1.xml")
  );
  expect(xml).not.toContain("Master");
  expect(xml).not.toContain('type="dt"');
  expect(xml).not.toContain('type="ftr"');
  expect((await readNotes(result.bytes, {}, context))[0]).toMatchObject({
    text: "New speaker",
    master: "/ppt/notesMasters/notesMaster1.xml"
  });
  expect(entries(result.bytes).get(name)).toEqual(map.get(name));
});

it("does not count text-like extension payload as speaker text", async () => {
  const extension = `<a:extLst xmlns:a="${a}"><a:ext uri="opaque"><a:p><a:r><a:t>Hidden extension</a:t></a:r></a:p></a:ext></a:extLst>`;
  const input = await authoredNotes(ph(3, "body", "Visible", extension));
  expect((await readNotes(input, {}, context))[0]?.text).toBe("Visible");
});
it.each(["\u0000", "\ud800", "\ufffe"])("rejects invalid speaker Unicode %j", async (text) => {
  const input = await createPresentation({ slides: [{}] }, context);
  await expect(mutateNotes(input, "set", { selection, text }, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
});
it("uses one master for explicit creation across selected slides", async () => {
  const input = await createPresentation({ slides: [{}, {}] }, context);
  const result = await mutateNotes(
    input,
    "set",
    { selection: { all: true }, text: "All speakers" },
    context
  );
  expect(await readNotes(result.bytes, {}, context)).toMatchObject([
    { slide: 1, master: "/ppt/notesMasters/notesMaster1.xml" },
    { slide: 2, master: "/ppt/notesMasters/notesMaster1.xml" }
  ]);
  expect(result.affected).toBe(2);
});
