import { expect, it } from "vitest";
import { inspectDocumentObjects, extractDocumentObjects } from "./objects.js";
import { chartFixture, chartContext, sheetMime } from "../tests/fixtures/charts.js";
import { publication } from "../tests/fixtures/object-publication.js";
import { r, paragraph } from "../tests/fixtures/text.js";
import { readArchive } from "./archive.js";
import { editDocumentParagraphs } from "./paragraph-edit.js";
import { getDocxDiscovery } from "./discovery.js";
import { validateDocxInvocation } from "./command.js";

const oleMime = "application/vnd.openxmlformats-officedocument.oleObject";
const payload = Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225, 0, 255, 5);
const preview = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 255);
it("keeps embedded relationship parts out of the object candidate inventory", async () => {
  const input = await chartFixture({ definitions: [], body: paragraph("Retained"), resources: [
    { name: "word/embeddings/item.bin", type: oleMime, bytes: payload },
    { name: "word/embeddings/_rels/item.bin.rels", type: "application/vnd.openxmlformats-package.relationships+xml", bytes: new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') }
  ] });
  const result = await inspectDocumentObjects(input, {}, chartContext);
  expect(result.items.map(item => item.name)).toEqual(["/word/embeddings/item.bin"]);
});
const carrier = (id: string, shape: string, image = "preview") =>
  `<w:p><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml"><v:shape id="${shape}"><v:imagedata r:id="${image}"/></v:shape><o:OLEObject Type="Embed" ShapeID="${shape}" r:id="${id}"/></w:object></w:r></w:p>`;
async function fixture(
  body = carrier("ole", "shapeA") + carrier("ole", "shapeB") + paragraph("Unrelated prose")
) {
  return chartFixture({
    definitions: [],
    body,
    resources: [
      { name: "word/embeddings/object.bin", type: oleMime, bytes: payload },
      {
        name: "word/embeddings/book.bin",
        type: sheetMime,
        bytes: Uint8Array.of(80, 75, 3, 4, 0, 255)
      },
      { name: "word/media/preview.png", type: "image/png", bytes: preview }
    ],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "ole",
        type: r + "/oleObject",
        target: "embeddings/object.bin"
      },
      {
        owner: "/word/document.xml",
        id: "book",
        type: r + "/package",
        target: "embeddings/book.bin"
      },
      {
        owner: "/word/document.xml",
        id: "preview",
        type: r + "/image",
        target: "media/preview.png"
      }
    ]
  });
}
it("retains physical OLE occurrences, shape-bound previews and shared owner graphs", async () => {
  const result = await inspectDocumentObjects(await fixture(), {}, chartContext);
  expect(result.items).toHaveLength(3);
  const objects = result.items.filter((item) => item.details.role === "ole");
  expect(objects.map((item) => item.details.resource?.sha256)).toEqual([
    objects[0]!.details.resource!.sha256,
    objects[0]!.details.resource!.sha256
  ]);
  for (const item of objects) {
    expect(item.details.previews).toMatchObject([
      { status: "internal", resource: { part: "/word/media/preview.png", bytes: preview.length } }
    ]);
    expect(item.details.owners).toHaveLength(2);
    expect(item.details.security).toEqual({
      macro: "unknown",
      protected: "unknown",
      content: "opaque"
    });
  }
  expect(
    result.items.find((item) => item.details.role === "package")?.details.resource?.bytes
  ).toBe(6);
});
it("reports unresolved carrier IDs and never discloses external link credentials", async () => {
  const input = await chartFixture({
    definitions: [],
    body: carrier("missing", "shapeA", "none") + carrier("linked", "shapeB", "none"),
    relationships: [
      {
        owner: "/word/document.xml",
        id: "linked",
        type: r + "/oleObject",
        target: "https://person:credential@example.invalid/data?token=private",
        external: true
      }
    ]
  });
  const result = await inspectDocumentObjects(input, {}, chartContext);
  expect(result.items.map((item) => item.details.status)).toEqual([
    "missing-relationship",
    "external"
  ]);
  expect(JSON.stringify(result)).not.toContain("credential");
  expect(JSON.stringify(result)).not.toContain("private");
  expect(result.warnings.length).toBeGreaterThan(0);
  const { fs, volume } = publication(input);
  const data = await extractDocumentObjects(
    input,
    { outputDir: "/out" },
    { ...chartContext, encoding: { compression: "store", order: "input" }, filesystem: fs }
  );
  expect(data.complete).toBe(false);
  expect(data.entries).toEqual([]);
  expect(volume.readdirSync("/out")).toEqual(["manifest.json"]);
});
it("extracts exact inert bytes and deterministic manifests without extracting shared previews", async () => {
  const input = await fixture(),
    { fs, volume } = publication(input);
  const result = await extractDocumentObjects(
    input,
    { outputDir: "/out", allowPartialOutput: true },
    { ...chartContext, encoding: { compression: "store", order: "input" }, filesystem: fs }
  );
  expect(result.complete).toBe(true);
  expect(result.entries).toHaveLength(3);
  expect(volume.readFileSync("/out/object-1.bin")).toEqual(Buffer.from(payload));
  expect(volume.readFileSync("/out/object-2.bin")).toEqual(Buffer.from(payload));
  expect(volume.readFileSync("/out/object-3.bin")).toEqual(Buffer.from([80, 75, 3, 4, 0, 255]));
  expect(JSON.parse(String(volume.readFileSync("/out/manifest.json")))).toMatchObject({
    version: 1,
    kind: "objects",
    entries: [{ path: "object-1.bin" }, { path: "object-2.bin" }, { path: "object-3.bin" }]
  });
  expect(result.entries.every((entry) => entry.published)).toBe(true);
  expect(result.manifest.published).toBe(true);
});
it.each(["relative", "/out/../escape", "/out//nested", "/out/", "/out\0bad"])(
  "rejects noncanonical extraction destination %s without mutation",
  async (outputDir) => {
    const input = await fixture(),
      { fs, volume } = publication(input);
    await expect(
      extractDocumentObjects(
        input,
        { outputDir, allowPartialOutput: true },
        { ...chartContext, encoding: { compression: "store", order: "input" }, filesystem: fs }
      )
    ).rejects.toMatchObject({ code: "usage" });
    expect(volume.readdirSync("/out")).toEqual([]);
  }
);
it("preflights symlinks, collisions and partial-output consent before creating objects", async () => {
  const input = await fixture(),
    { fs, volume } = publication(input),
    context = {
      ...chartContext,
      encoding: { compression: "store" as const, order: "input" as const },
      filesystem: fs
    };
  await expect(extractDocumentObjects(input, { outputDir: "/out" }, context)).rejects.toMatchObject(
    { code: "unsupported-publication" }
  );
  volume.writeFileSync("/out/object-2.bin", "Keep existing bytes");
  await expect(
    extractDocumentObjects(input, { outputDir: "/out", allowPartialOutput: true }, context)
  ).rejects.toMatchObject({ code: "conflict" });
  expect(volume.existsSync("/out/object-1.bin")).toBe(false);
  volume.mkdirSync("/elsewhere");
  volume.symlinkSync("/elsewhere", "/out/alias");
  await expect(
    extractDocumentObjects(input, { outputDir: "/out/alias", allowPartialOutput: true }, context)
  ).rejects.toMatchObject({ code: "unsupported-publication" });
  expect(volume.readdirSync("/elsewhere")).toEqual([]);
});
it("reports partial publication receipts with no rollback fiction", async () => {
  const input = await fixture(),
    { fs, volume } = publication(input, true);
  await expect(
    extractDocumentObjects(
      input,
      { outputDir: "/out", allowPartialOutput: true },
      { ...chartContext, encoding: { compression: "store", order: "input" }, filesystem: fs }
    )
  ).rejects.toMatchObject({
    code: "sink-failure",
    data: {
      complete: false,
      entries: [{ published: true }, { published: false }, { published: false }],
      manifest: { published: false }
    }
  });
  expect(volume.readFileSync("/out/object-1.bin")).toEqual(Buffer.from(payload));
});
it("keeps original object, workbook, previews and relationships byte-exact on an unrelated paragraph edit", async () => {
  const input = await fixture(),
    { fs, volume } = publication(input);
  await editDocumentParagraphs(
    input,
    {
      operation: "paragraphs.set",
      options: { paragraph: 3, text: "Changed prose", output: "/out/edited.docx" }
    },
    { ...chartContext, encoding: { compression: "store", order: "input" }, filesystem: fs }
  );
  const before = await readArchive(input, chartContext),
    after = await readArchive(
      new Uint8Array(volume.readFileSync("/out/edited.docx") as Buffer),
      chartContext
    );
  for (const member of before.members.filter((member) => member.name !== "word/document.xml"))
    expect(after.members.find((other) => other.name === member.name)?.bytes).toEqual(member.bytes);
  expect(
    (
      await inspectDocumentObjects(
        new Uint8Array(volume.readFileSync("/out/edited.docx") as Buffer),
        {},
        chartContext
      )
    ).items
  ).toHaveLength(3);
});
it("retains dangling target and outer macro admission failures", async () => {
  const missing = await chartFixture({
    definitions: [],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "absent",
        type: r + "/package",
        target: "embeddings/absent.bin"
      }
    ]
  });
  await expect(inspectDocumentObjects(missing, {}, chartContext)).rejects.toMatchObject({
    code: "invalid-package"
  });
  const macro = await chartFixture({
    definitions: [],
    resources: [
      {
        name: "word/macro.bin",
        type: "application/vnd.ms-office.vbaProject",
        bytes: Uint8Array.of(1)
      }
    ]
  });
  await expect(inspectDocumentObjects(macro, {}, chartContext)).rejects.toMatchObject({
    code: "unsupported-profile"
  });
});
it("advertises only bounded object utility paths with F40 read support", () => {
  const schema = getDocxDiscovery(
    validateDocxInvocation({
      operation: "schema",
      inputs: [],
      options: { operation: "objects.list" }
    })
  )!;
  expect(schema.data).toMatchObject({
    operations: [{ id: "objects.list", featureIds: ["F40"], support: "read" }]
  });
});

it("does not invent preview ownership for duplicate or mismatched shape identifiers", async () => {
  const duplicate = carrier("ole", "same").replace(
    "</v:shape>",
    '</v:shape><v:shape id="same"><v:imagedata r:id="preview"/></v:shape>'
  );
  const result = await inspectDocumentObjects(await fixture(duplicate), {}, chartContext);
  expect(result.items[0]!.details.previews).toEqual([
    { relationshipId: null, status: "ambiguous", resource: null }
  ]);
});
it("inventories unrecognized object carriers without dumping their content", async () => {
  const input = await chartFixture({
    definitions: [],
    body: "<w:p><w:r><w:object><w:unknown>Confidential object text</w:unknown></w:object></w:r></w:p>"
  });
  const data = await inspectDocumentObjects(input, {}, chartContext);
  expect(data.items).toMatchObject([{ details: { role: "unknown", resource: null } }]);
  expect(JSON.stringify(data)).not.toContain("Confidential");
});
it("reports declared macro packages and outer protection without password material", async () => {
  const input = await chartFixture({
    definitions: [],
    body: paragraph("Protected content"),
    resources: [
      {
        name: "word/settings.xml",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
        bytes: `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:enforcement="1" w:hash="SensitiveHash" w:salt="SensitiveSalt"/></w:settings>`
      },
      {
        name: "word/embeddings/book.bin",
        type: "application/vnd.ms-excel.sheet.macroEnabled.12",
        bytes: Uint8Array.of(80, 75, 3, 4)
      }
    ],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "book",
        type: r + "/package",
        target: "embeddings/book.bin"
      }
    ]
  });
  const data = await inspectDocumentObjects(input, {}, chartContext);
  expect(data.document.protected).toBe(true);
  expect(data.items[0]!.details.security.macro).toBe("declared");
  expect(JSON.stringify(data)).not.toContain("Sensitive");
});
it("selects individual and owner occurrences with stale selection rejection", async () => {
  const input = await fixture(),
    all = await inspectDocumentObjects(input, {}, chartContext);
  expect(
    (await inspectDocumentObjects(input, { select: all.items[1]!.location.token }, chartContext))
      .items
  ).toHaveLength(1);
  expect((await inspectDocumentObjects(input, { paragraph: 2 }, chartContext)).items).toHaveLength(
    1
  );
  await expect(
    inspectDocumentObjects(
      await fixture(carrier("ole", "changed")),
      { select: all.items[0]!.location.token },
      chartContext
    )
  ).rejects.toMatchObject({ code: "stale-selection" });
});
it("bounds exact total extraction bytes and file counts including the manifest", async () => {
  const input = await fixture(
    Array.from({ length: 12 }, (_, i) => carrier("ole", "shape" + i)).join("")
  );
  const context = () => ({
    ...chartContext,
    encoding: { compression: "store" as const, order: "input" as const },
    filesystem: publication(input).fs
  });
  const data = await extractDocumentObjects(
    input,
    { outputDir: "/out", allowPartialOutput: true },
    context()
  );
  const bytes = data.entries.reduce((total, entry) => total + entry.bytes, data.manifest.bytes),
    fileCount = data.entries.length + 1;
  await expect(
    extractDocumentObjects(
      input,
      { outputDir: "/out", allowPartialOutput: true },
      {
        ...context(),
        limits: { ...chartContext.limits, maxTotalBytes: bytes, maxMembers: fileCount }
      }
    )
  ).resolves.toMatchObject({ complete: true });
  const { fs, volume } = publication(input);
  await expect(
    extractDocumentObjects(
      input,
      { outputDir: "/out", allowPartialOutput: true },
      { ...context(), filesystem: fs, limits: { ...chartContext.limits, maxTotalBytes: bytes - 1 } }
    )
  ).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(volume.readdirSync("/out")).toEqual([]);
  await expect(
    extractDocumentObjects(
      input,
      { outputDir: "/out", allowPartialOutput: true },
      {
        ...context(),
        filesystem: fs,
        limits: { ...chartContext.limits, maxMembers: fileCount - 1 }
      }
    )
  ).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(volume.readdirSync("/out")).toEqual([]);
});

it("preserves a complete original embedded workbook archive as inert bytes", async () => {
  const { Volume } = await import("memfs"),
    { writeArchive } = await import("./archive-write.js");
  const volume = Volume.fromJSON({ "/workbook": "" }),
    s = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const files = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="${r}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${s}" xmlns:r="${r}"><sheets><sheet name="Observations" sheetId="1" r:id="sheet"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="${r}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${s}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Original water sample</t></is></c><c r="B1"><v>12.5</v></c></row></sheetData></worksheet>`
  };
  await writeArchive(
    {
      comment: Uint8Array.of(5),
      members: Object.entries(files).map(([name, text]) => ({
        name,
        bytes: new TextEncoder().encode(text),
        directory: false,
        modified: new Date("2025-01-02T03:04:06Z")
      }))
    },
    {
      async write(bytes) {
        volume.appendFileSync("/workbook", bytes);
      }
    },
    { compression: "store", order: "input" },
    chartContext
  );
  const workbook = new Uint8Array(volume.readFileSync("/workbook") as Buffer);
  const input = await chartFixture({
    definitions: [],
    resources: [{ name: "word/embeddings/book.xlsx", type: sheetMime, bytes: workbook }],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "book",
        type: r + "/package",
        target: "embeddings/book.xlsx"
      }
    ]
  });
  const extracted = publication(input);
  const receipt = await extractDocumentObjects(
    input,
    { outputDir: "/out", allowPartialOutput: true },
    {
      ...chartContext,
      encoding: { compression: "store", order: "input" },
      filesystem: extracted.fs
    }
  );
  expect(receipt.entries[0]!.bytes).toBe(workbook.length);
  expect(extracted.volume.readFileSync("/out/object-1.bin")).toEqual(Buffer.from(workbook));
});

it("does not match absent shape identifiers as verified preview ownership", async () => {
  const input = await fixture(
    carrier("ole", "shapeA").replace('id="shapeA"', "").replace('ShapeID="shapeA"', "")
  );
  expect(
    (await inspectDocumentObjects(input, {}, chartContext)).items[0]!.details.previews
  ).toEqual([{ relationshipId: null, status: "ambiguous", resource: null }]);
});
