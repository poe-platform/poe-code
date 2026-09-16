import { beforeAll, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  createDocumentArchive,
  writeDocumentArchive,
  replaceDocumentText,
  validateDocumentArchive
} from "../src/index.js";
import { textContext, textFixture, paragraph, w } from "./fixtures/text.js";
import {
  readPackage,
  assertPackageLinks,
  assertWordReferences,
  assertPreserved
} from "./assertions.js";
import { verifySchemaProfile, schemaCheck } from "./schema-consumer.js";

beforeAll(verifySchemaProfile);

it.each(["docx", "dotx"] as const)(
  "validates original %s creation, styles and nested tables",
  async (kind) => {
    const archive = await createDocumentArchive(
      {
        kind,
        content: {
          version: 1,
          blocks: [
            { kind: "paragraph", level: 0, text: "Coastal survey" },
            { kind: "paragraph", runs: [{ text: "Eastern pier", bold: true, italic: false }] },
            {
              kind: "table",
              rows: [
                [
                  { blocks: [{ kind: "paragraph", text: "Sample" }] },
                  { blocks: [{ kind: "table", rows: [[{ blocks: [] }]] }] }
                ]
              ]
            }
          ]
        }
      },
      textContext
    );
    const volume = Volume.fromJSON({ "/output": "" });
    await writeDocumentArchive(
      archive,
      {
        async write(bytes) {
          volume.appendFileSync("/output", bytes);
        }
      },
      { compression: "store", order: "name" },
      textContext
    );
    const parts = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
    assertPackageLinks(parts);
    assertWordReferences(parts);
    for (const [name, bytes] of parts) {
      const schema =
        name === "[Content_Types].xml"
          ? "opc/opc-contentTypes.xsd"
          : name.endsWith(".rels")
            ? "opc/opc-relationships.xsd"
            : "transitional-profile.xsd";
      expect(schemaCheck(bytes, schema), name).toMatchObject({ status: "valid" });
    }
  }
);

it("validates preserving replacement and retains every unrelated part", async () => {
  const input = await textFixture("<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>coast</w:t></w:r></w:p>");
  const volume = Volume.fromJSON({ "/output": "" });
  await replaceDocumentText(
    input,
    { find: "coast", with: "shore", all: true, output: "-" },
    {
      ...textContext,
      encoding: { compression: "store", order: "input" },
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/output", bytes);
        }
      }
    }
  );
  const before = readPackage(input),
    after = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
  assertPackageLinks(after);
  assertWordReferences(after);
  assertPreserved(before, after, new Map([["word/document.xml", after.get("word/document.xml")!]]));
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain("<w:b/>");
  expect(schemaCheck(after.get("word/document.xml")!, "transitional-profile.xsd").status).toBe(
    "valid"
  );
});

it.each([
  "<w:p><w:unexpected/></w:p>",
  '<w:p><w:pPr><w:spacing w:after="not-a-number"/></w:pPr></w:p>',
  '<w:p><w:r><w:rPr><w:b w:val="perhaps"/></w:rPr></w:r></w:p>',
  "<w:p><w:r></w:p>"
])("rejects an original schema negative control: %s", (body) => {
  const bytes = new TextEncoder().encode(
    `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`
  );
  expect(schemaCheck(bytes, "transitional-profile.xsd").status).toBe("invalid");
});

it("keeps dangling-reference assertions authoritative after schema success", async () => {
  const input = await textFixture(
    '<w:p><w:hyperlink r:id="absent"><w:r><w:t>Survey link</w:t></w:r></w:hyperlink></w:p>'
  );
  const parts = readPackage(input);
  expect(schemaCheck(parts.get("word/document.xml")!, "transitional-profile.xsd").status).toBe(
    "valid"
  );
  expect(() => assertPackageLinks(parts)).toThrow("dangling relationship");
  const archive = {
    comment: new Uint8Array(),
    members: [...parts].map(([name, bytes]) => ({
      name,
      bytes,
      directory: false,
      modified: new Date("1980-01-01T00:00:00Z")
    }))
  };
  expect(validateDocumentArchive(archive).valid).toBe(false);
});

it("classifies required compatibility extensions without stripping input", async () => {
  const input = await textFixture(paragraph("Retained annotation"));
  const bytes = new TextEncoder().encode(
    new TextDecoder()
      .decode(readPackage(input).get("word/document.xml"))
      .replace(
        "<w:document ",
        '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:annotation" mc:Ignorable="x" '
      )
  );
  const before = bytes.slice();
  expect(schemaCheck(bytes, "transitional-profile.xsd")).toMatchObject({ status: "invalid" });
  expect(bytes).toEqual(before);
});

it("reports the pinned Strict schema compilation discrepancy separately", async () => {
  const archive = await createDocumentArchive({ dialect: "strict" }, textContext);
  const result = schemaCheck(
    archive.members.find((member) => member.name === "word/document.xml")!.bytes,
    "strict-profile.xsd"
  );
  expect(result.status).toBe("schema-unavailable");
  expect(result.diagnostics).toContain("beforeAutospacing");
  expect(result.diagnostics).toContain("afterAutospacing");
  expect(result.diagnostics).toContain("nlCheck");
  expect(validateDocumentArchive(archive).valid).toBe(true);
});
