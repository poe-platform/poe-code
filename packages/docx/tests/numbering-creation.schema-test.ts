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
