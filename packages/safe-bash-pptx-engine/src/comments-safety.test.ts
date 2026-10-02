import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPptxCommandEngine } from "./command-engine.js";
import { mutateComments, readComments } from "./comments.js";
import { createPresentation } from "./creation.js";
import { importSlides } from "./slide-import.js";
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
const selection = {
  kind: "slide" as const,
  position: { coordinateSystem: "one-based" as const, value: 1 }
};
const ns = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const encode = (text: string) => new TextEncoder().encode(text);
function entries(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(inspectZip(bytes).map((entry) => [entry.name, entry.payload]));
}
function append(parts: Map<string, Uint8Array>, name: string, markup: string) {
  const xml = parseXmlPart(parts.get(name)!, context.xmlLimits);
  parts.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [markup]).bytes());
}
async function fixture(security?: "signature" | "protection") {
  const legacy = await mutateComments(
    await createPresentation({ slides: [{}] }, context),
    "add",
    {
      selection,
      author: "Casey",
      timestamp: "2030-02-03T04:05:06Z",
      text: "Legacy review"
    },
    context
  );
  const parts = entries(legacy.bytes);
  parts.set(
    "ppt/thread.xml",
    encode(
      `<m:cmLst xmlns:m="${ns}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><m:cm id="thread-a" authorId="person-a" created="2030-02-03T05:00:00Z"><m:txBody><a:p><a:r><a:t>Modern review</a:t></a:r></a:p></m:txBody><m:extLst><x:association xmlns:x="urn:review:opaque" parentId="thread-a"/></m:extLst></m:cm></m:cmLst>`
    )
  );
  parts.set(
    "ppt/persons.xml",
    encode(
      `<m:authorLst xmlns:m="${ns}"><m:author id="person-a" name="Casey" userId="casey@example.test" providerId="directory"/></m:authorLst>`
    )
  );
  for (const [owner, target, kind] of [
    ["ppt/slides/_rels/slide1.xml.rels", "../thread.xml", "comments"],
    ["ppt/_rels/presentation.xml.rels", "persons.xml", "authors"]
  ]) {
    append(
      parts,
      owner!,
      `<Relationship xmlns="${rel}" Id="modern" Type="http://schemas.microsoft.com/office/2018/10/relationships/${kind}" Target="${target}"/>`
    );
  }
  for (const [name, kind] of [
    ["thread", "comments"],
    ["persons", "authors"]
  ]) {
    append(
      parts,
      "[Content_Types].xml",
      `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/${name}.xml" ContentType="application/vnd.ms-powerpoint.${kind}+xml"/>`
    );
  }
  if (security === "signature") {
    parts.set("seal.xml", encode('<seal xmlns="urn:review:seal"/>'));
    append(
      parts,
      "[Content_Types].xml",
      '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/seal.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/>'
    );
    append(
      parts,
      "_rels/.rels",
      `<Relationship xmlns="${rel}" Id="seal" Type="${rel}/digital-signature/origin" Target="seal.xml"/>`
    );
  }
  if (security === "protection") {
    append(
      parts,
      "ppt/presentation.xml",
      '<p:modifyVerifier xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" cryptProviderType="rsaAES"/>'
    );
  }
  const fs = Volume.fromJSON({});
  fs.writeFileSync(
    "/deck.pptx",
    await writePackageArchive(
      [...parts].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "auto" }
    )
  );
  return new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
}
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
describe("coexisting review format safety", () => {
  it("edits legacy text while retaining modern author and thread bytes and associations", async () => {
    const input = await fixture();
    const original = entries(input);
    const legacy = (await readComments(input, {}, context)).find(
      (row) => row.text === "Legacy review"
    )!;
    const result = await mutateComments(
      input,
      "set",
      { selection, id: legacy.id, text: "Revised legacy review" },
      context
    );
    const output = entries(result.bytes);
    for (const name of [
      "ppt/thread.xml",
      "ppt/persons.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/_rels/presentation.xml.rels"
    ])
      expect(output.get(name)).toEqual(original.get(name));
    expect((await readComments(result.bytes, {}, context)).map((row) => row.text)).toEqual([
      "Revised legacy review",
      "Modern review"
    ]);
  });
  it.each([
    "extension",
    "attribute",
    "comment-list attribute",
    "author-list attribute",
    "sibling attribute"
  ])("rejects legacy author reassignment with an opaque %s identity", async (kind) => {
    const parts = entries(await fixture());
    const name =
      kind === "author-list attribute" ? "ppt/commentAuthors.xml" : "ppt/comments/comment1.xml";
    let xml = parseXmlPart(parts.get(name)!, context.xmlLimits);
    if (kind === "sibling attribute") {
      xml = xml.spliceChildren(xml.root, xml.root.children.length, 0, [
        '<p:cm xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" authorId="0" idx="2" dt="2030-02-03T04:05:06Z"><p:pos x="0" y="0"/><p:text>Another review</p:text></p:cm>'
      ]);
    }
    const node = kind.endsWith("list attribute")
      ? xml.root
      : xml.root.children[kind === "sibling attribute" ? 1 : 0]!;
    parts.set(
      name,
      (kind === "extension"
        ? xml.spliceChildren(node, node.children.length, 0, [
            '<x:association xmlns:x="urn:review:opaque" authorId="0" parentId="0:1"/>'
          ])
        : xml.merge(node, {
            attributes: [{ namespace: "urn:review:opaque", localName: "personId", value: "0" }]
          })
      ).bytes()
    );
    const input = await writePackageArchive(
      [...parts].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "auto" }
    );
    const legacy = (await readComments(input, {}, context)).find(
      (row) => row.text === "Legacy review"
    )!;
    const changed = await mutateComments(
      input,
      "set",
      { selection, id: legacy.id, text: "Retained identity" },
      context
    );
    expect(
      (await readComments(changed.bytes, {}, context)).find((row) => row.id === legacy.id)?.text
    ).toBe("Retained identity");
    const result = await mutateComments(
      input,
      "set",
      { selection, id: legacy.id, author: "Morgan" },
      context
    ).then(
      () => ({ code: "unexpected-success" }),
      (error) => error
    );
    expect(result).toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/deck.pptx", input);
    const publishOutput = vi.fn();
    const response = await createPptxCommandEngine({
      context,
      maxArgumentBytes: 65536,
      maxOutputBytes: 1000000
    }).execute({
      args: [
        "comments",
        "set",
        "/deck.pptx",
        "--slide",
        "1",
        "--id",
        legacy.id,
        "--author",
        "Morgan",
        "--output",
        "/result.pptx",
        "--json"
      ].map(encode),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
      publishOutput
    });
    expect(response.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(response.stdout))).toMatchObject({
      operation: "comments.set",
      affected: 0,
      errors: [{ code: "unsupported-edit" }]
    });
    expect(publishOutput).not.toHaveBeenCalled();
    expect(fs.readFileSync("/deck.pptx")).toEqual(Buffer.from(input));
  });
  it("rejects slide import that would require modern identity remapping", async () => {
    const source = await fixture();
    await expect(
      importSlides(
        await createPresentation({ slides: [{}] }, context),
        source,
        { sourceSlides: [1] },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it.each(["signature", "protection"] as const)(
    "allows inventory but rejects legacy mutation in a %s package",
    async (security) => {
      const input = await fixture(security);
      const original = input.slice();
      const rows = await readComments(input, {}, context);
      expect(rows.map((row) => row.text)).toEqual(["Legacy review", "Modern review"]);
      const legacy = rows.find((row) => row.text === "Legacy review")!;
      await expect(
        mutateComments(input, "set", { selection, id: legacy.id, text: "Change" }, context)
      ).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(input).toEqual(original);
    }
  );
});
