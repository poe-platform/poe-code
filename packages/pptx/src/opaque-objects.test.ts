import { Volume } from "memfs";
import { expect, it } from "vitest";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readObjects, extractObject } from "./opaque-objects.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 65536,
    maxMembers: 50,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 50, maxRelationships: 50 }
};
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encoder = new TextEncoder();
const payload = new Uint8Array([0, 255, 13, 10, 60, 33, 68, 79, 67, 84, 89, 80, 69]);
function fixture(
  type: string,
  relationship: string,
  extra: { name: string; bytes: Uint8Array }[] = []
) {
  const xml = (name: string, value: string) => ({ name, bytes: encoder.encode(value) });
  const bytes = storedArchive([
    xml(
      "[Content_Types].xml",
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/object.bin" ContentType="${type}"/></Types>`
    ),
    xml(
      "_rels/.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="opaque" Type="${relationship}" Target="object.bin"/></Relationships>`
    ),
    { name: "object.bin", bytes: payload },
    ...extra
  ]);
  const volume = Volume.fromJSON({ "/input": Buffer.from(bytes) });
  return new Uint8Array(volume.readFileSync("/input") as Buffer);
}
it.each([
  ["application/vnd.openxmlformats-officedocument.oleObject", `${r}/oleObject`, "ole", true],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `${r}/package`,
    "package",
    true
  ],
  ["application/vnd.ms-office.activeX+xml", `${r}/control`, "control", true],
  [
    "application/vnd.ms-office.webextension+xml",
    "http://schemas.microsoft.com/office/2011/relationships/webextension",
    "web-extension",
    true
  ],
  ["application/x-fontdata", `${r}/font`, "font", false],
  [
    "model/gltf-binary",
    "http://schemas.microsoft.com/office/2017/06/relationships/model3d",
    "model3d",
    false
  ]
])(
  "inventories opaque %s bytes without parsing payloads",
  async (type, rel, kind, activeContent) => {
    const bytes = fixture(String(type), String(rel));
    const result = await readObjects(bytes, context);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toMatchObject({
      part: "/object.bin",
      kind,
      activeContent,
      bytes: 13,
      sha256: "932fbea772eedc8fde47c91abaf57ff0eaa72848454991a6250f08e877b69592",
      owners: ["/"],
      dependencies: [],
      missing: []
    });
    expect(result.activationPerformed).toBe(false);
    expect(result.recursiveParsingPerformed).toBe(false);
    const extracted = await extractObject(bytes, { part: "/object.bin" }, context);
    expect(extracted.bytes).toEqual(payload);
  }
);
it.each([
  ["APPLICATION/VND.MS-OFFICE.VBAPROJECT;version=1", "active-payload", true],
  ["application/vnd.ms-office.activeX+xml ; charset=utf-8", "control", true],
  ["application/vnd.ms-office.webextension+xml;charset=utf-8", "web-extension", true],
  ["application/vnd.openxmlformats-officedocument.oleObject;version=1", "ole", true],
  ["application/x-fontdata;version=1", "font", false],
  ["model/gltf+json;charset=utf-8", "model3d", false]
] as const)(
  "classifies parameterized %s without activating its bytes",
  async (type, kind, active) => {
    const input = fixture(type, "urn:unclassified");
    const original = new Uint8Array(input);
    const result = await readObjects(input, context);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toMatchObject({
      part: "/object.bin",
      contentType: type,
      kind,
      activeContent: active,
      activeReasons: active ? [`potentially-active-${kind}`] : [],
      bytes: 13,
      sha256: "932fbea772eedc8fde47c91abaf57ff0eaa72848454991a6250f08e877b69592"
    });
    expect(result.activationPerformed).toBe(false);
    expect(result.recursiveParsingPerformed).toBe(false);
    expect((await extractObject(input, { part: "/object.bin" }, context)).bytes).toEqual(payload);
    expect(input).toEqual(original);
  }
);
it("does not classify a media type from a parameter value", async () => {
  const result = await readObjects(
    fixture(
      "application/octet-stream;hint=&quot;application/vnd.ms-office.vbaProject&quot;",
      "urn:unclassified"
    ),
    context
  );
  expect(result.objects).toEqual([]);
});
it("extracts cyclic dependency closure and original relationship bytes with safe unique names", async () => {
  const rels = encoder.encode(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sidecar" Type="urn:opaque-sidecar" Target="aux.bin"/><Relationship Id="outside" Type="urn:link" Target="https://example.invalid/never-fetch" TargetMode="External"/></Relationships>`
  );
  const cycle = encoder.encode(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="back" Type="urn:opaque-sidecar" Target="object.bin"/></Relationships>`
  );
  const source = fixture("application/vnd.ms-office.activeX+xml", `${r}/control`, [
    { name: "_rels/object.bin.rels", bytes: rels },
    { name: "aux.bin", bytes: new Uint8Array([77, 90, 0]) },
    { name: "_rels/aux.bin.rels", bytes: cycle }
  ]);
  const inventory = await readObjects(source, context);
  expect(inventory.objects.find((row) => row.part === "/object.bin")).toMatchObject({
    dependencies: ["/aux.bin"],
    externalRelationships: [{ id: "outside", external: true }]
  });
  const output = await extractObject(source, { part: "/object.bin" }, context);
  const files = [output, ...output.dependencies];
  expect(files.map((file) => file.part).sort()).toEqual([
    "/_rels/aux.bin.rels",
    "/_rels/object.bin.rels",
    "/aux.bin",
    "/object.bin"
  ]);
  expect(output.dependencies.find((file) => file.part === "/_rels/object.bin.rels")?.bytes).toEqual(
    rels
  );
  expect(output.dependencies.find((file) => file.part === "/_rels/aux.bin.rels")?.bytes).toEqual(
    cycle
  );
  expect(new Set(files.map((file) => file.name)).size).toBe(4);
  for (const file of files) {
    expect(
      [...file.name].every((char) => "abcdefghijklmnopqrstuvwxyz0123456789-.".includes(char))
    ).toBe(true);
    expect(file.name.startsWith("opaque-")).toBe(true);
    expect(file.name.includes("..")).toBe(false);
  }
  expect(output.relationships).toHaveLength(3);
});
it.each([
  [77, 90],
  [127, 69, 76, 70],
  [208, 207, 17, 224, 161, 177, 26, 225]
])("detects unlabelled executable or compound signatures %j", async (...signature) => {
  const input = fixture("application/octet-stream", "urn:unknown", [
    { name: "active.bin", bytes: new Uint8Array(signature) }
  ]);
  const result = await readObjects(input, context);
  expect(result.objects.find((row) => row.part === "/active.bin")).toMatchObject({
    activeContent: true
  });
});
it("reports dangling closure and refuses incomplete extraction", async () => {
  const input = fixture("application/x-fontdata", `${r}/font`, [
    {
      name: "_rels/object.bin.rels",
      bytes: encoder.encode(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="missing" Type="urn:opaque" Target="missing.bin"/></Relationships>`
      )
    }
  ]);
  expect((await readObjects(input, context)).objects[0]?.missing).toEqual(["/missing.bin"]);
  await expect(extractObject(input, { part: "/object.bin" }, context)).rejects.toMatchObject({
    code: "missing-binding"
  });
});
it.each(["../object.bin", "/object.bin/../object.bin", "file:///object.bin", "/absent.bin"])(
  "rejects invalid extraction selector %s",
  async (part) => {
    await expect(
      extractObject(fixture("application/x-fontdata", `${r}/font`), { part }, context)
    ).rejects.toBeDefined();
  }
);
it("reads font declarations and embedded variants without interpreting font bytes", async () => {
  const bytes = storedArchive([
    {
      name: "[Content_Types].xml",
      bytes: encoder.encode(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      bytes: encoder.encode(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="deck.xml"/></Relationships>`
      )
    },
    {
      name: "deck.xml",
      bytes: encoder.encode(
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${r}"><p:embeddedFontLst><p:embeddedFont><p:font typeface="Original Typeface" charset="0" pitchFamily="34"/><p:regular r:id="regular"/><p:bold r:id="absent"/></p:embeddedFont></p:embeddedFontLst></p:presentation>`
      )
    },
    {
      name: "_rels/deck.xml.rels",
      bytes: encoder.encode(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="regular" Type="${r}/font" Target="font.fntdata"/></Relationships>`
      )
    },
    { name: "font.fntdata", bytes: payload }
  ]);
  const { readFonts } = await import("./opaque-objects.js");
  const result = await readFonts(bytes, context);
  expect(result.declarations).toEqual([
    {
      part: "/deck.xml",
      typeface: "Original Typeface",
      charset: "0",
      pitchFamily: "34",
      variants: [
        { variant: "regular", relationshipId: "regular", part: "/font.fntdata", missing: false },
        { variant: "bold", relationshipId: "absent", part: null, missing: true }
      ]
    }
  ]);
  expect(result.fonts.map((font) => font.part)).toEqual(["/font.fntdata"]);
  expect(result.installationPerformed).toBe(false);
});
it("detects a macro relationship even when its content type is generic", async () => {
  const result = await readObjects(
    fixture(
      "application/octet-stream",
      "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
    ),
    context
  );
  expect(result.objects[0]).toMatchObject({ kind: "active-payload", activeContent: true });
});
it("returns owned byte copies and rejects accessor selectors without invoking them", async () => {
  const input = fixture("application/x-fontdata", `${r}/font`);
  const before = input.slice();
  const first = await extractObject(input, { part: "/object.bin" }, context);
  first.bytes.fill(1);
  expect((await extractObject(input, { part: "/object.bin" }, context)).bytes).toEqual(payload);
  expect(input).toEqual(before);
  let invoked = false;
  await expect(
    extractObject(
      input,
      {
        get part() {
          invoked = true;
          return "/object.bin";
        }
      },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(invoked).toBe(false);
});
it.each([[77], [127, 69, 76], [208, 207, 17, 224, 161, 177, 26], [0, 77, 90]])(
  "does not report incomplete or displaced active signatures %j",
  async (...signature) => {
    const input = fixture("application/octet-stream", "urn:unknown", [
      { name: "passive.bin", bytes: new Uint8Array(signature) }
    ]);
    expect((await readObjects(input, context)).objects).toEqual([]);
  }
);
