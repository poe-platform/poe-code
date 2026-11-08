import { validateXmlPartReplacement } from "./xml-parts.js";
import { describe, expect, it } from "vitest";
import { createDeckFixture } from "../tests/fixtures/decks.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { opaqueContext } from "../tests/fixtures/opaque-deck.js";
import { readPackage, type PackageReader } from "./package-reader.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
import { validateXmlViewReplacement } from "./xml-view-validation.js";

const context = {
  ...opaqueContext,
  validationLimits: {
    ...opaqueContext.xmlLimits,
    ...opaqueContext.relationshipLimits,
    maxEntries: 100
  }
};
const part = "/ppt/slides/slide1.xml";
async function fixture() {
  const { volume, root } = createDeckFixture("seed-library");
  return readPackage(
    storedArchive(
      Object.keys(volume.toJSON()).map((path) => ({
        name: path.slice(root.length + 1),
        bytes: new Uint8Array(volume.readFileSync(path) as Buffer)
      }))
    ),
    context
  );
}
function nodes(root: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.localName === name) result.push(node);
    pending.push(...node.children);
  }
  return result;
}
function withPart(reader: PackageReader, bytes: Uint8Array): PackageReader {
  return { ...reader, get: (name) => (name === part ? bytes : reader.get(name)) };
}

describe("structured XML view publication", () => {
  it("permits unchanged owned drawing reorder and preserves every other package part", async () => {
    const reader = await fixture();
    const document = parseXmlPart(reader.get(part), context.validationLimits);
    const tree = nodes(document.root, "spTree")[0]!;
    const next = document.reorderChildren(tree, [
      ...tree.children.slice(0, 2),
      tree.children[3]!,
      tree.children[2]!,
      ...tree.children.slice(4)
    ]);
    const candidate = validateXmlViewReplacement(
      reader,
      part,
      next.bytes(),
      context,
      validateXmlPartReplacement
    );
    expect(candidate.get(part)).toEqual(next.bytes());
    for (const name of reader.names)
      if (name !== part) expect(candidate.get(name)).toEqual(reader.get(name));
  });
  it("allows run removal while retaining its required paragraph and end formatting", async () => {
    const reader = await fixture();
    const document = parseXmlPart(reader.get(part), context.validationLimits);
    const paragraph = nodes(document.root, "p")[0]!;
    const next = document.spliceChildren(paragraph, 0, 1, []);
    const candidate = validateXmlViewReplacement(
      reader,
      part,
      next.bytes(),
      context,
      validateXmlPartReplacement
    );
    expect(candidate.get(part)).toEqual(next.bytes());
  });
  it("rejects required header removal, invented structure and opaque removal", async () => {
    const reader = await fixture();
    const document = parseXmlPart(reader.get(part), context.validationLimits);
    const tree = nodes(document.root, "spTree")[0]!;
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        document.spliceChildren(tree, 0, 1, []).bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        document.spliceChildren(tree, 3, 1, []).bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
    const invented = document.spliceChildren(tree, 2, 0, [
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'
    ]);
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        invented.bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
    const frameIndex = tree.children.findIndex((node) => node.name.localName === "graphicFrame");
    expect(frameIndex).toBeGreaterThan(-1);
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        document.spliceChildren(tree, frameIndex, 1, []).bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
  });
  it("rejects removal of unknown namespace attributes and preserves paragraph ordering", async () => {
    const reader = await fixture();
    const document = parseXmlPart(reader.get(part), context.validationLimits);
    const paragraph = nodes(document.root, "p")[0]!;
    const reversed = document.reorderChildren(paragraph, [...paragraph.children].reverse());
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        reversed.bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
    const tree = nodes(document.root, "spTree")[0]!;
    const tagged = document.merge(tree.children[2]!, {
      attributes: [{ namespace: "urn:custom-state", localName: "marker", value: "keep" }]
    });
    const taggedTree = nodes(tagged.root, "spTree")[0]!;
    const removed = tagged.spliceChildren(taggedTree, 2, 1, []);
    expect(() =>
      validateXmlViewReplacement(
        withPart(reader, tagged.bytes()),
        part,
        removed.bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
    const changedText = document.setText(nodes(document.root, "t")[0]!, "Updated original message");
    expect(
      validateXmlViewReplacement(
        reader,
        part,
        changedText.bytes(),
        context,
        validateXmlPartReplacement
      ).get(part)
    ).toEqual(changedText.bytes());
  });
  it.each(["remove", "reorder"] as const)(
    "rejects %s of a duplicate opaque run occurrence",
    async (operation) => {
      const reader = await fixture();
      const document = parseXmlPart(reader.get(part), context.validationLimits);
      const paragraph = nodes(document.root, "p")[0]!;
      const run =
        '<a:r xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:u="urn:opaque-run" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u" u:state="keep"><a:t>Repeated original text</a:t></a:r>';
      const baseline = document.spliceChildren(paragraph, 0, 1, [
        run,
        run,
        '<a:br xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>'
      ]);
      const owned = nodes(baseline.root, "p")[0]!;
      const candidate =
        operation === "remove"
          ? baseline.spliceChildren(owned, 1, 1, [])
          : baseline.reorderChildren(owned, [
              owned.children[0]!,
              owned.children[2]!,
              owned.children[1]!,
              ...owned.children.slice(3)
            ]);
      expect(() =>
        validateXmlViewReplacement(
          withPart(reader, baseline.bytes()),
          part,
          candidate.bytes(),
          context,
          validateXmlPartReplacement
        )
      ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    }
  );
  it("retains shared validation for dangling relationship values, protection and limits", async () => {
    const reader = await fixture();
    const document = parseXmlPart(reader.get(part), context.validationLimits);
    const picture = nodes(document.root, "blip")[0]!;
    const dangling = document.merge(picture, {
      attributes: [
        {
          namespace: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          localName: "embed",
          value: "missing"
        }
      ]
    });
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        dangling.bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
    expect(() =>
      validateXmlViewReplacement(
        reader,
        part,
        document.bytes(),
        {
          ...context,
          validationLimits: { ...context.validationLimits, maxNodes: 1 }
        },
        validateXmlPartReplacement
      )
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
    const protectedDocument = document.spliceChildren(
      document.root,
      document.root.children.length,
      0,
      ['<p:modifyVerifier xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>']
    );
    expect(() =>
      validateXmlViewReplacement(
        withPart(reader, protectedDocument.bytes()),
        part,
        protectedDocument.bytes(),
        context,
        validateXmlPartReplacement
      )
    ).toThrow();
  });
});
