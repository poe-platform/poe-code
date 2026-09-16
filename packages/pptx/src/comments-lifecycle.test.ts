import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { importSlides } from "./slide-import.js";
import { removeSlides } from "./slide-removal.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";

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
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const encode = (text: string) => new TextEncoder().encode(text);
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/deck") as Buffer)).map((x) => [x.name, x.payload])
  );
}
function append(map: Map<string, Uint8Array>, name: string, markup: string) {
  const doc = parseXmlPart(map.get(name)!, context.xmlLimits);
  map.set(name, doc.spliceChildren(doc.root, doc.root.children.length, 0, [markup]).bytes());
}
function attributes(bytes: Uint8Array, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.uri === p && tag.local === local)
      result.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((a) => !a.uri)
            .map((a) => [a.local, a.value])
        )
      );
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return result;
}
async function annotated(twoAuthors = false) {
  const map = parts(
    await createPresentation({ slides: [{ name: "First" }, { name: "Second" }] }, context)
  );
  map.set(
    "ppt/commentAuthors.xml",
    encode(
      `<p:cmAuthorLst xmlns:p="${p}"><p:cmAuthor id="0" name="Sam" initials="S" lastIdx="7" clrIdx="0"/>${twoAuthors ? '<p:cmAuthor id="9" name="Sam" initials="T" lastIdx="3" clrIdx="1"/>' : ""}</p:cmAuthorLst>`
    )
  );
  append(
    map,
    "ppt/_rels/presentation.xml.rels",
    `<Relationship xmlns="${rel}" Id="authors" Type="${r}/commentAuthors" Target="commentAuthors.xml"/>`
  );
  append(
    map,
    "[Content_Types].xml",
    `<Override xmlns="${ct}" PartName="/ppt/commentAuthors.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"/>`
  );
  for (const [slide, author, index] of [
    [1, 0, 7],
    [2, twoAuthors ? 9 : 0, twoAuthors ? 3 : 6]
  ]) {
    map.set(
      `ppt/comments/comment${slide}.xml`,
      encode(
        `<p:cmLst xmlns:p="${p}"><p:cm authorId="${author}" dt="2026-01-02T03:04:05Z" idx="${index}"><p:pos x="12" y="-9"/><p:text>Review ${slide}</p:text></p:cm></p:cmLst>`
      )
    );
    append(
      map,
      `ppt/slides/_rels/slide${slide}.xml.rels`,
      `<Relationship xmlns="${rel}" Id="comments" Type="${r}/comments" Target="../comments/comment${slide}.xml"/>`
    );
    append(
      map,
      "[Content_Types].xml",
      `<Override xmlns="${ct}" PartName="/ppt/comments/comment${slide}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"/>`
    );
  }
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "auto" }
  );
}
describe("comment ownership across slide lifecycle", () => {
  it("imports distinct author identities despite equal names and colliding IDs", async () => {
    const source = await annotated(true);
    const destination = await annotated();
    const before = parts(destination);
    const output = parts(
      await importSlides(destination, source, { sourceSlides: [1, 2] }, context)
    );
    const authors = attributes(output.get("ppt/commentAuthors.xml")!, "cmAuthor");
    expect(authors).toEqual([
      { id: "0", name: "Sam", initials: "S", lastIdx: "7", clrIdx: "0" },
      { id: "1", name: "Sam", initials: "S", lastIdx: "7", clrIdx: "0" },
      { id: "2", name: "Sam", initials: "T", lastIdx: "3", clrIdx: "1" }
    ]);
    for (const [slide, author, idx] of [
      [1, "1", "7"],
      [2, "2", "3"]
    ] as const) {
      const comment = output.get(`ppt/comments/comment${slide}-import1.xml`)!;
      expect(attributes(comment, "cm")).toEqual([
        { authorId: author, dt: "2026-01-02T03:04:05Z", idx }
      ]);
      expect(attributes(comment, "pos")).toEqual([{ x: "12", y: "-9" }]);
    }
    expect(output.get("ppt/comments/comment1.xml")).toEqual(
      before.get("ppt/comments/comment1.xml")
    );
    expect(output.get("ppt/comments/comment2.xml")).toEqual(
      before.get("ppt/comments/comment2.xml")
    );
  });
  it("creates author registration when importing into an unannotated deck", async () => {
    const destination = await createPresentation({ slides: [{ name: "Blank" }] }, context);
    const output = parts(
      await importSlides(destination, await annotated(), { sourceSlides: [1] }, context)
    );
    const authorPart = [...output.keys()].find(
      (name) => name.includes("commentAuthors") && name.endsWith(".xml")
    )!;
    expect(attributes(output.get(authorPart)!, "cmAuthor")).toEqual([
      { id: "0", name: "Sam", initials: "S", lastIdx: "7", clrIdx: "0" }
    ]);
  });
  it("removes only the author whose final comment was deleted", async () => {
    const input = await annotated(true);
    const output = parts(
      await removeSlides(
        input,
        { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } } },
        context
      )
    );
    expect(attributes(output.get("ppt/commentAuthors.xml")!, "cmAuthor")).toEqual([
      { id: "9", name: "Sam", initials: "T", lastIdx: "3", clrIdx: "1" }
    ]);
    expect(output.has("ppt/comments/comment1.xml")).toBe(false);
    expect(output.get("ppt/comments/comment2.xml")).toEqual(
      parts(input).get("ppt/comments/comment2.xml")
    );
  });
  it("rejects duplicate comment identities before importing a slide", async () => {
    const source = parts(await annotated());
    const name = "ppt/comments/comment1.xml";
    const document = parseXmlPart(source.get(name)!, context.xmlLimits);
    source.set(
      name,
      document
        .spliceChildren(document.root, 1, 0, [document.markup(document.root.children[0]!, true)])
        .bytes()
    );
    const bytes = await writePackageArchive(
      [...source].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "auto" }
    );
    const destination = await createPresentation({ slides: [{}] }, context);
    await expect(
      importSlides(destination, bytes, { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it.each([
    ["comment extension", "ppt/comments/comment1.xml", "cm", "child"],
    ["comment attribute", "ppt/comments/comment1.xml", "cm", "attribute"],
    ["position attribute", "ppt/comments/comment1.xml", "pos", "attribute"],
    ["text extension", "ppt/comments/comment1.xml", "text", "child"],
    ["author attribute", "ppt/commentAuthors.xml", "cmAuthor", "attribute"],
    ["author-list attribute", "ppt/commentAuthors.xml", "cmAuthorLst", "attribute"]
  ])("rejects identity remapping with an opaque %s", async (_label, name, local, kind) => {
    const source = parts(await annotated());
    const document = parseXmlPart(source.get(name!)!, context.xmlLimits);
    const pending = [document.root];
    while (pending[0]?.name.localName !== local) {
      const node = pending.shift()!;
      pending.push(...node.children);
    }
    const node = pending[0]!;
    const changed =
      kind === "child"
        ? document.spliceChildren(node, node.children.length, 0, [
            '<x:identity xmlns:x="urn:review:identity" authorId="0" parentId="0:7"/>'
          ])
        : document.merge(node, {
            attributes: [{ namespace: "urn:review:identity", localName: "personId", value: "0" }]
          });
    source.set(name!, changed.bytes());
    const input = await writePackageArchive(
      [...source].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "auto" }
    );
    const before = input.slice();
    await expect(
      importSlides(await annotated(), input, { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
    expect(input).toEqual(before);
    const volume = Volume.fromJSON({});
    const destination = await annotated();
    volume.writeFileSync("/source.pptx", input);
    volume.writeFileSync("/destination.pptx", destination);
    const publishOutput = vi.fn();
    const response = await createPptxCommandEngine({
      context,
      maxArgumentBytes: 65536,
      maxOutputBytes: 1000000
    }).execute({
      args: [
        "slides",
        "import",
        "/destination.pptx",
        "--source",
        "/source.pptx",
        "--source-slides",
        "[1]",
        "--output",
        "/result.pptx",
        "--json"
      ].map(encode),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput
    });
    expect(response.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(response.stdout))).toMatchObject({
      operation: "slides.import",
      affected: 0,
      errors: [{ code: "unsupported-edit" }]
    });
    expect(publishOutput).not.toHaveBeenCalled();
    expect(volume.readFileSync("/source.pptx")).toEqual(Buffer.from(before));
    expect(volume.readFileSync("/destination.pptx")).toEqual(Buffer.from(destination));
  });
  it("retains opaque destination author identity attributes without remapping them", async () => {
    const destination = parts(await annotated());
    const name = "ppt/commentAuthors.xml";
    const xml = parseXmlPart(destination.get(name)!, context.xmlLimits);
    destination.set(
      name,
      xml
        .merge(xml.root.children[0]!, {
          attributes: [
            { namespace: "urn:review:identity", localName: "personId", value: "keep-person" }
          ]
        })
        .bytes()
    );
    const before = parseXmlPart(destination.get(name)!, context.xmlLimits);
    const input = await writePackageArchive(
      [...destination].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "auto" }
    );
    const output = parts(
      await importSlides(input, await annotated(), { sourceSlides: [1] }, context)
    );
    const result = parseXmlPart(output.get(name)!, context.xmlLimits);
    expect(result.markup(result.root.children[0]!, true)).toEqual(
      before.markup(before.root.children[0]!, true)
    );
    expect(attributes(output.get(name)!, "cmAuthor").map((author) => author.id)).toEqual([
      "0",
      "1"
    ]);
  });
  it("retains an author still referenced on another slide", async () => {
    const input = await annotated();
    const output = parts(
      await removeSlides(
        input,
        { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } } },
        context
      )
    );
    expect(output.get("ppt/commentAuthors.xml")).toEqual(
      parts(input).get("ppt/commentAuthors.xml")
    );
  });
});
