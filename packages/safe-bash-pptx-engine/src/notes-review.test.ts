import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { mutateNotes, readNotes } from "./notes.js";
import { readSelectionIndex } from "./selectors.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
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
const selection = (value: number) => ({
  kind: "slide" as const,
  position: { coordinateSystem: "one-based" as const, value }
});
const all = { kind: "slide" as const, all: true };
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((part) => [
      part.name,
      part.payload
    ])
  );
}
function archive(map: Map<string, Uint8Array>) {
  return storedArchive([...map].map(([name, bytes]) => ({ name, bytes })));
}
function text(bytes: Uint8Array) {
  const values: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  let active = false;
  parser.on("opentag", (tag) => {
    active = tag.local === "t";
  });
  parser.on("text", (value) => {
    if (active) values.push(value);
  });
  parser.on("closetag", () => {
    active = false;
  });
  parser.write(decoder.decode(bytes)).close();
  return values;
}
async function deck() {
  return createPresentation({ slides: [{ name: "Echo" }, { name: "Echo" }] }, context);
}
async function withNotes() {
  return (await mutateNotes(await deck(), "add", { selection: all, text: "Saved words" }, context))
    .bytes;
}
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
describe("notes selection and atomicity review", () => {
  it.each([true, 42, [], Object.create({ selection: { all: true } })])(
    "rejects non-record read options case %# without coercion",
    async (value) => {
      const input = await deck();
      await expect(
        readNotes(input, value as Parameters<typeof readNotes>[1], context)
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
  );
  it.each([false, 0, "", null])(
    "rejects explicit invalid read selection case %#",
    async (value) => {
      const input = await deck();
      await expect(
        readNotes(
          input,
          { selection: value } as unknown as Parameters<typeof readNotes>[1],
          context
        )
      ).rejects.toMatchObject({ code: "invalid-selection" });
    }
  );
  it.each([true, 42, [], Object.create({ all: true })])(
    "rejects non-record mutation selection case %#",
    async (value) => {
      const input = await createPresentation({ slides: [{}] }, context);
      await expect(
        mutateNotes(
          input,
          "set",
          { selection: value, text: "Rejected" } as Parameters<typeof mutateNotes>[2],
          context
        )
      ).rejects.toMatchObject({ code: "invalid-selection" });
    }
  );
  it("rejects ambiguous named slides before creating any notes", async () => {
    const input = await deck(),
      before = input.slice();
    await expect(
      mutateNotes(
        input,
        "set",
        { selection: { kind: "slide", name: "Echo" }, text: "New words" },
        context
      )
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    expect(input).toEqual(before);
    expect([...parts(input).keys()].some((name) => name.includes("notesSlides"))).toBe(false);
  });
  it("rejects a previously issued token after package mutation, even with allowEmpty", async () => {
    const input = await deck();
    const token = (await readSelectionIndex(input, context)).slides[0]!.token;
    const updated = await mutateNotes(
      input,
      "add",
      { selection: selection(1), text: "Revision" },
      context
    );
    await expect(
      mutateNotes(
        updated.bytes,
        "set",
        { selection: { token }, text: "Stale write", allowEmpty: true },
        context
      )
    ).rejects.toMatchObject({ code: "stale-selection" });
    await expect(readNotes(updated.bytes, { selection: { token } }, context)).rejects.toMatchObject(
      { code: "stale-selection" }
    );
  });
  it.each(["missing-master", "duplicate-notes-edge"] as const)(
    "rejects %s graphs with a structured error on reads and mutations",
    async (mode) => {
      const map = parts(await withNotes());
      const path =
        mode === "missing-master"
          ? "ppt/notesSlides/_rels/notesSlide1.xml.rels"
          : "ppt/slides/_rels/slide1.xml.rels";
      const doc = parseXmlPart(map.get(path)!, context.xmlLimits);
      if (mode === "missing-master") {
        const at = doc.root.children.findIndex((node) =>
          node.attributes.some(
            (attr) => attr.name.localName === "Type" && attr.value === `${r}/notesMaster`
          )
        );
        map.set(path, doc.spliceChildren(doc.root, at, 1, []).bytes());
      } else
        map.set(
          path,
          doc
            .spliceChildren(doc.root, doc.root.children.length, 0, [
              `<Relationship xmlns="${rel}" Id="extraNotes" Type="${r}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`
            ])
            .bytes()
        );
      const input = archive(map),
        before = input.slice();
      await expect(readNotes(input, {}, context)).rejects.toMatchObject({ code: "invalid-opc" });
      await expect(
        mutateNotes(input, "set", { selection: selection(1), text: "Rejected" }, context)
      ).rejects.toMatchObject({ code: "invalid-opc" });
      expect(input).toEqual(before);
    }
  );
  it("does not publish earlier additions when a later selected slide already has notes", async () => {
    const input = (
      await mutateNotes(
        await deck(),
        "add",
        { selection: selection(2), text: "Keep second" },
        context
      )
    ).bytes;
    const before = input.slice();
    await expect(
      mutateNotes(input, "add", { selection: all, text: "Replace all" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(input).toEqual(before);
    expect(text(parts(input).get("ppt/notesSlides/notesSlide1.xml")!)).toContain("Keep second");
    expect(parts(input).has("ppt/notesSlides/notesSlide2.xml")).toBe(false);
  });
  it("does not emit earlier changes when a later speaker paragraph contains opaque content", async () => {
    const map = parts(await withNotes());
    const path = "ppt/notesSlides/notesSlide2.xml";
    const doc = parseXmlPart(map.get(path)!, context.xmlLimits);
    const pending = [doc.root];
    let paragraph = doc.root;
    while (pending.length) {
      const node = pending.pop()!;
      if (node.name.localName === "p" && doc.markup(node).includes("Saved words")) {
        paragraph = node;
        break;
      }
      pending.push(...node.children);
    }
    expect(paragraph).not.toBe(doc.root);
    map.set(
      path,
      doc
        .spliceChildren(paragraph, paragraph.children.length, 0, [
          '<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext uri="urn:review"><x:retained xmlns:x="urn:review">Hold this</x:retained></a:ext></a:extLst>'
        ])
        .bytes()
    );
    const input = archive(map),
      before = input.slice();
    await expect(
      mutateNotes(input, "set", { selection: all, text: "Overwrite" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(input).toEqual(before);
    expect(text(map.get("ppt/notesSlides/notesSlide1.xml")!)).toContain("Saved words");
    expect(decoder.decode(map.get(path))).toContain("Hold this");
  });
  it("selects the actual note master relationship and preserves it through text edits", async () => {
    const map = parts(await withNotes());
    map.set("ppt/notesMasters/extra.xml", map.get("ppt/notesMasters/notesMaster1.xml")!);
    const types = parseXmlPart(map.get("[Content_Types].xml")!, context.xmlLimits);
    map.set(
      "[Content_Types].xml",
      types
        .spliceChildren(types.root, types.root.children.length, 0, [
          '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/notesMasters/extra.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
        ])
        .bytes()
    );
    const path = "ppt/notesSlides/_rels/notesSlide2.xml.rels";
    const rels = parseXmlPart(map.get(path)!, context.xmlLimits);
    const edge = rels.root.children.find((node) =>
      node.attributes.some((attr) => attr.value === `${r}/notesMaster`)
    )!;
    map.set(
      path,
      rels
        .merge(edge, {
          attributes: [{ namespace: "", localName: "Target", value: "../notesMasters/extra.xml" }]
        })
        .bytes()
    );
    const input = archive(map);
    expect((await readNotes(input, { selection: selection(2) }, context))[0]!.master).toBe(
      "/ppt/notesMasters/extra.xml"
    );
    const output = await mutateNotes(
      input,
      "set",
      { selection: selection(2), text: "Second owner" },
      context
    );
    expect(parts(output.bytes).get(path)).toEqual(map.get(path));
    expect(parts(output.bytes).get("ppt/notesMasters/extra.xml")).toEqual(
      map.get("ppt/notesMasters/extra.xml")
    );
    expect(parts(output.bytes).get("ppt/notesSlides/notesSlide1.xml")).toEqual(
      map.get("ppt/notesSlides/notesSlide1.xml")
    );
    expect(text(parts(output.bytes).get("ppt/notesSlides/notesSlide2.xml")!)).toContain(
      "Second owner"
    );
  });
});

describe("notes command review", () => {
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 1000000
  });
  it("lists notes selected by a current opaque slide token", async () => {
    const input = await withNotes();
    const token = (await readSelectionIndex(input, context)).slides[1]!.token;
    const result = await engine.execute({
      args: ["notes", "list", "/input.pptx", "--select", token, "--json"].map((value) =>
        encoder.encode(value)
      ),
      readInput: async () => input,
      signal: new AbortController().signal
    });
    expect(result.exitCode, decoder.decode(result.stdout)).toBe(0);
    expect(
      JSON.parse(decoder.decode(result.stdout)).data.notes.map(
        (note: { slide: number }) => note.slide
      )
    ).toEqual([2]);
  });
  it("rejects an unrelated scope before reading the input", async () => {
    const readInput = vi.fn(async () => new Uint8Array());
    const publishOutput = vi.fn();
    const result = await engine.execute({
      args: [
        "notes",
        "set",
        "/input.pptx",
        "--scope",
        "slides",
        "--slide",
        "1",
        "--text",
        "Words",
        "--dry-run",
        "--json"
      ].map((value) => encoder.encode(value)),
      readInput,
      publishOutput,
      signal: new AbortController().signal
    });
    expect(result.exitCode).toBe(2);
    expect(readInput).not.toHaveBeenCalled();
    expect(publishOutput).not.toHaveBeenCalled();
  });
  it("never invokes publication if an all-slide addition encounters existing notes", async () => {
    const input = (
      await mutateNotes(await deck(), "add", { selection: selection(2), text: "Retained" }, context)
    ).bytes;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/input.pptx", input);
    const publishOutput = vi.fn();
    const result = await engine.execute({
      args: [
        "notes",
        "add",
        "/input.pptx",
        "--all",
        "--text",
        "Rejected",
        "--output",
        "/output.pptx",
        "--json"
      ].map((value) => encoder.encode(value)),
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput,
      signal: new AbortController().signal
    });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(decoder.decode(result.stdout)).errors[0].code).toBe("invalid-value");
    expect(publishOutput).not.toHaveBeenCalled();
    expect(new Uint8Array(volume.readFileSync("/input.pptx") as Buffer)).toEqual(input);
  });
  it("returns a null optional note without a publication side effect", async () => {
    const input = await deck(),
      publishOutput = vi.fn();
    const result = await engine.execute({
      args: ["notes", "get", "/input.pptx", "--slide", "1", "--json"].map((value) =>
        encoder.encode(value)
      ),
      readInput: async () => input,
      publishOutput,
      signal: new AbortController().signal
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(result.stdout)).data).toBeNull();
    expect(publishOutput).not.toHaveBeenCalled();
  });
});
