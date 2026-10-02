import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, XmlPartView, UnsupportedEditError } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";

async function fixture(content: string) {
  const volume = Volume.fromJSON({ "/leaf.xml": content });
  const model = await openDocumentStyleModel(undefined, textContext);
  const part = await XmlPartView.load(
    "/records/leaf.xml",
    "application/xml",
    new Uint8Array(volume.readFileSync("/leaf.xml") as Buffer),
    model.package
  );
  part.load_rel("urn:original:notes", model.styles.part, "rId42");
  return { part, model };
}

it.each([
  {
    label: "transitional ID",
    ns: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    local: "id"
  },
  {
    label: "strict ID",
    ns: "http://purl.oclc.org/ooxml/officeDocument/relationships",
    local: "id"
  },
  {
    label: "embedded target",
    ns: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    local: "embed"
  },
  {
    label: "linked target",
    ns: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    local: "link"
  },
  { label: "legacy target", ns: "urn:schemas-microsoft-com:office:office", local: "relid" }
])("protects nested references for $label", async ({ ns, local }) => {
  const { part } = await fixture(
    `<leaf xmlns:q="${ns}"><branch><seed q:${local}="rId42"/></branch></leaf>`
  );
  const bytes = part.blob,
    xml = part.rels.xml,
    edge = part.rels.at("rId42");
  expect(() => part.drop_rel("rId42")).toThrow(UnsupportedEditError);
  expect(part.blob).toEqual(bytes);
  expect(part.rels.xml).toBe(xml);
  expect(part.rels.at("rId42")).toBe(edge);
});

it.each(["clear", "pop", "popitem"] as const)(
  "keeps collection %s transactional when a reference remains",
  async (action) => {
    const { part, model } = await fixture(
      '<leaf xmlns:q="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><seed q:id="rId42"/></leaf>'
    );
    part.load_rel("urn:original:extra", model.package.main_document_part, "rId9");
    const before = part.rels.xml;
    if (action === "popitem") {
      part.drop_rel("rId9");
      expect(() => part.rels.popitem()).toThrow(UnsupportedEditError);
    } else {
      expect(() => (action === "clear" ? part.rels.clear() : part.rels.pop("rId42"))).toThrow(
        UnsupportedEditError
      );
      expect(part.rels.xml).toBe(before);
    }
    expect(part.rels.has("rId42")).toBe(true);
  }
);

it("does not confuse text comments or foreign attributes with relationship references", async () => {
  const { part } = await fixture(
    '<leaf xmlns:q="urn:original:soil" q:id="rId42"><!--rId42-->rId42</leaf>'
  );
  const bytes = part.blob;
  part.drop_rel("rId42");
  expect(part.rels.has("rId42")).toBe(false);
  expect(part.blob).toEqual(bytes);
});

it("scopes the same identifier to its XML owner", async () => {
  const { part, model } = await fixture(
    '<leaf xmlns:q="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><seed q:id="rId42"/></leaf>'
  );
  const other = await XmlPartView.load(
    "/records/branch.xml",
    "application/xml",
    new TextEncoder().encode("<branch/>"),
    model.package
  );
  other.load_rel("urn:original:notes", model.styles.part, "rId42");
  other.drop_rel("rId42");
  expect(other.rels.has("rId42")).toBe(false);
  expect(part.rels.has("rId42")).toBe(true);
});
