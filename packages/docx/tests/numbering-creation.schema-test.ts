import { beforeAll, expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, NumberingPart } from "../src/index.js";
import { paragraph, textContext, textFixture } from "./fixtures/text.js";
import { readPackage, assertPackageLinks, assertWordReferences } from "./assertions.js";
import { schemaCheck, verifySchemaProfile } from "./schema-consumer.js";

beforeAll(verifySchemaProfile);

it.each([false, true])(
  "independently validates created numbering OPC metadata and preserves payloads; strict=%s",
  async (strict) => {
    const input = await textFixture(paragraph("Numbering admission"), {}, strict);
    const model = await Document(input, textContext),
      part = NumberingPart.new(model.part.package);
    const volume = Volume.fromJSON({ "/output": "" });
    await model.save({
      async write(bytes) {
        volume.appendFileSync("/output", bytes);
      }
    });
    const parts = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
    assertPackageLinks(parts);
    assertWordReferences(parts);
    for (const [name, bytes] of readPackage(input)) {
      if (name !== "[Content_Types].xml" && name !== "word/_rels/document.xml.rels")
        expect(parts.get(name), name).toEqual(bytes);
    }
    expect(
      schemaCheck(parts.get("[Content_Types].xml")!, "opc/opc-contentTypes.xsd")
    ).toMatchObject({ status: "valid" });
    expect(
      schemaCheck(parts.get("word/_rels/document.xml.rels")!, "opc/opc-relationships.xsd")
    ).toMatchObject({ status: "valid" });
    expect(parts.get(part.partname.membername)).toEqual(part.blob);
  }
);

it("validates the new Transitional numbering root against the pinned WML schema", async () => {
  const model = await Document(await textFixture(paragraph("Numbering grammar")), textContext);
  const part = NumberingPart.new(model.part.package);
  expect(schemaCheck(part.blob, "transitional-profile.xsd")).toMatchObject({ status: "valid" });
});

it.each([
  {
    name: "canonical level",
    children: '<w:startOverride w:val="0"/><w:lvl w:ilvl="+0"/>',
    status: "valid"
  },
  {
    name: "duplicate level",
    children: '<w:lvl w:ilvl="0"/><w:lvl w:ilvl="00"/>',
    status: "invalid"
  },
  {
    name: "duplicate start",
    children: '<w:startOverride w:val="1"/><w:startOverride w:val="2"/>',
    status: "invalid"
  },
  { name: "missing nested level ID", children: "<w:lvl/>", status: "invalid" }
])("independently checks numbering override grammar: $name", ({ children, status }) => {
  const xml = `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="00">${children}</w:lvlOverride></w:num></w:numbering>`;
  expect(schemaCheck(new TextEncoder().encode(xml), "transitional-profile.xsd")).toMatchObject({
    status
  });
});
