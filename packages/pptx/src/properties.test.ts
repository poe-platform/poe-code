import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
import { readProperties, mutateProperty, sanitizeProperties } from "./properties.js";
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
const strings = [
  "author",
  "category",
  "comments",
  "content_status",
  "identifier",
  "keywords",
  "language",
  "last_modified_by",
  "subject",
  "title",
  "version"
];
function xml(bytes: Uint8Array, name: string) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck", bytes);
  return new TextDecoder().decode(
    inspectZip(new Uint8Array(fs.readFileSync("/deck") as Buffer)).find((e) => e.name === name)!
      .payload
  );
}
describe("typed presentation properties", () => {
  it.each(strings)("round trips core string %s and distinguishes absence", async (name) => {
    const source = await createPresentation({}, context);
    expect(await readProperties(source, { name }, context)).toEqual([]);
    const added = await mutateProperty(
      source,
      "set",
      { name, type: "string", value: "A & <B>" },
      context
    );
    expect(xml(added.bytes, "docProps/core.xml")).toContain("A &amp; &lt;B&gt;");
    expect(await readProperties(added.bytes, { name }, context)).toMatchObject([
      { name, value: "A & <B>", type: "string", kind: "core" }
    ]);
    const cleared = await mutateProperty(added.bytes, "set", { name, value: "" }, context);
    expect((await readProperties(cleared.bytes, { name }, context))[0]?.value).toBe("");
    const removed = await mutateProperty(cleared.bytes, "remove", { name }, context);
    expect(await readProperties(removed.bytes, { name }, context)).toEqual([]);
  });
  it.each(["created", "modified", "last_printed"])(
    "writes caller UTC seconds for %s",
    async (name) => {
      const source = await createPresentation({}, context);
      const result = await mutateProperty(
        source,
        "set",
        { name, type: "date", value: "2024-02-29T13:14:15Z" },
        context
      );
      expect((await readProperties(result.bytes, { name }, context))[0]?.value).toBe(
        "2024-02-29T13:14:15Z"
      );
      expect(xml(result.bytes, "docProps/core.xml")).toContain("2024-02-29T13:14:15Z");
      for (const value of [
        "2023-02-29T13:14:15Z",
        "2024-01-01",
        "2024-01-01T00:00:00.123Z",
        "2024-01-01T01:00:00+01:00"
      ])
        await expect(
          mutateProperty(result.bytes, "set", { name, value }, context)
        ).rejects.toMatchObject({ code: "invalid-value" });
    }
  );
  it("bounds strings by Unicode points and revisions without coercion", async () => {
    const source = await createPresentation({}, context);
    const toString = vi.fn(() => "coerced");
    await expect(
      mutateProperty(
        source,
        "set",
        { name: "title", value: { toString } as unknown as string },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(toString).not.toHaveBeenCalled();
    await expect(
      mutateProperty(
        source,
        "set",
        { name: "title", type: "string", value: "😀".repeat(255) },
        context
      )
    ).resolves.toBeDefined();
    await expect(
      mutateProperty(
        source,
        "set",
        { name: "title", type: "string", value: "😀".repeat(256) },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
    for (const value of [-1, 1.5, "7", NaN, Infinity, true, Number.MAX_SAFE_INTEGER + 1])
      await expect(
        mutateProperty(source, "set", { name: "revision", type: "number", value }, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
    const added = await mutateProperty(
      source,
      "set",
      { name: "revision", type: "number", value: 0 },
      context
    );
    expect((await readProperties(added.bytes, {}, context))[0]?.value).toBe(0);
  });
  it.each([
    ["string", ""],
    ["number", 0],
    ["boolean", false],
    ["date", "2022-01-02T03:04:05Z"]
  ] as const)("retains explicit custom %s values", async (type, value) => {
    const source = await createPresentation({}, context);
    await expect(
      mutateProperty(source, "set", { name: "Review", value }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    const result = await mutateProperty(source, "set", { name: "Review", type, value }, context);
    expect(await readProperties(result.bytes, {}, context)).toMatchObject([
      { name: "Review", type, value, kind: "custom" }
    ]);
    const sanitized = await sanitizeProperties(result.bytes, context);
    expect(await readProperties(sanitized.bytes, {}, context)).toEqual([]);
  });
  it("rejects absent removal and unknown fields", async () => {
    const source = await createPresentation({}, context);
    await expect(
      mutateProperty(source, "remove", { name: "Missing" }, context)
    ).rejects.toMatchObject({ code: "missing-selection" });
    await expect(
      mutateProperty(source, "set", { name: "", type: "string", value: "" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
});

describe("live core metadata", () => {
  it("provides all neutral accessors with absent defaults and Date copies", async () => {
    const { openPropertySession } = await import("./properties.js");
    const source = await createPresentation({}, context);
    const session = await openPropertySession(source, context);
    for (const name of strings) {
      expect(Reflect.get(session.core_properties, name)).toBe("");
      Reflect.set(session.core_properties, name, "Original " + name);
    }
    expect(session.core_properties.created).toBeNull();
    expect(session.core_properties.revision).toBe(0);
    session.core_properties.revision = 7;
    session.core_properties.created = new Date("2021-02-03T04:05:06.987Z");
    const date = session.core_properties.created!;
    date.setUTCFullYear(1990);
    expect(session.core_properties.created?.getUTCFullYear()).toBe(2021);
    const saved = await session.save();
    expect(xml(saved, "docProps/core.xml")).toContain("2021-02-03T04:05:06Z");
    expect(xml(saved, "docProps/core.xml")).toContain(">7</");
    for (const name of strings)
      expect((await readProperties(saved, { name }, context))[0]?.value).toBe("Original " + name);
  });
});

import { writePackageArchive } from "./package-writer.js";
async function imported(core: string) {
  const source = await createPresentation({}, context);
  const members = inspectZip(source).map((e) => ({
    name: e.name,
    bytes:
      e.name === "docProps/core.xml"
        ? new TextEncoder().encode(
            `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:x="urn:retained">${core}</cp:coreProperties>`
          )
        : e.payload
  }));
  return writePackageArchive(members, context, { compression: "store" });
}
describe("imported metadata boundaries", () => {
  it("uses declared types for known core names", async () => {
    let source = await createPresentation({}, context);
    source = (await mutateProperty(source, "set", { name: "title", value: "Known" }, context))
      .bytes;
    source = (await mutateProperty(source, "set", { name: "revision", value: 0 }, context)).bytes;
    expect(xml(source, "docProps/core.xml")).toContain("Known");
  });
  it.each([
    ["42", 42],
    ["", 0],
    ["not numeric", 0],
    ["-17", 0],
    ["32.7", 0],
    ["7.0", 0],
    ["0x10", 0]
  ])("maps revision lexical value %s", async (raw, value) => {
    const { openPropertySession } = await import("./properties.js");
    const session = await openPropertySession(
      await imported(`<cp:revision>${raw}</cp:revision>`),
      context
    );
    expect(session.core_properties.revision).toBe(value);
  });
  it.each([
    ["2020", "2020-01-01T00:00:00.000Z"],
    ["2020-05", "2020-05-01T00:00:00.000Z"],
    ["2020-05-06", "2020-05-06T00:00:00.000Z"],
    ["2020-05-06T07:08:09+02:00", "2020-05-06T05:08:09.000Z"],
    ["2020-05-06T07:08:09-02:30", "2020-05-06T09:38:09.000Z"],
    ["", null],
    ["bad date", null],
    ["2023-02-29T00:00:00Z", null]
  ])("maps imported date lexical value %s", async (raw, value) => {
    const { openPropertySession } = await import("./properties.js");
    const source = await imported(`<dcterms:created>${raw}</dcterms:created>`);
    const session = await openPropertySession(source, context);
    expect(session.core_properties.created?.toISOString() ?? null).toBe(value);
    expect(xml(await session.save(), "docProps/core.xml")).toContain(raw);
  });
  it("rejects duplicate names and retains foreign metadata during sanitization", async () => {
    const source = await imported(
      "<dc:title>One</dc:title><dc:title>Two</dc:title><x:title>Foreign</x:title>"
    );
    await expect(
      mutateProperty(source, "set", { name: "title", value: "Changed" }, context)
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    const clean = await sanitizeProperties(source, context);
    expect(xml(clean.bytes, "docProps/core.xml")).toContain("<x:title>Foreign</x:title>");
    expect(xml(clean.bytes, "docProps/core.xml")).not.toContain("<dc:title>");
  });
  it("preserves extensions nested under recognized metadata", async () => {
    const source = await imported(
      '<dc:title x:mark="keep">Text<x:payload>opaque</x:payload></dc:title>'
    );
    await expect(
      mutateProperty(source, "set", { name: "title", value: "Changed" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    const clean = await sanitizeProperties(source, context);
    expect(xml(clean.bytes, "docProps/core.xml")).toContain("<x:payload>opaque</x:payload>");
  });
});

async function customImported(content: string) {
  let source = await createPresentation({}, context);
  source = (
    await mutateProperty(source, "set", { name: "Count", type: "number", value: 7 }, context)
  ).bytes;
  return writePackageArchive(
    inspectZip(source).map((e) => ({
      name: e.name,
      bytes:
        e.name === "docProps/custom.xml"
          ? new TextEncoder().encode(
              `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes" xmlns:x="urn:retained">${content}</Properties>`
            )
          : e.payload
    })),
    context,
    { compression: "store" }
  );
}
describe("custom property preservation", () => {
  it("keeps unknown types and namespaced associations while sanitizing supported scalars", async () => {
    const opaque =
      '<property name="Opaque" pid="3" fmtid="unchanged"><vt:vector size="1" baseType="lpwstr"><vt:lpwstr>Private</vt:lpwstr></vt:vector></property>';
    const linked =
      '<property name="Associated" pid="4" fmtid="unchanged" x:item="binding"><vt:lpwstr>Linked</vt:lpwstr></property>';
    const source = await customImported(
      `<property name="Count" pid="2"><vt:r8>7</vt:r8></property>${opaque}${linked}`
    );
    const changed = await mutateProperty(source, "set", { name: "Count", value: 9 }, context);
    expect(xml(changed.bytes, "docProps/custom.xml")).toContain(opaque);
    const clean = await sanitizeProperties(changed.bytes, context);
    expect(xml(clean.bytes, "docProps/custom.xml")).toContain(opaque);
    expect(xml(clean.bytes, "docProps/custom.xml")).toContain(linked);
    expect(xml(clean.bytes, "docProps/custom.xml")).not.toContain('name="Count"');
  });
  it("rejects duplicate custom names and collisions with known core names", async () => {
    const duplicate = await customImported(
      '<property name="Count" pid="2"><vt:r8>7</vt:r8></property><property name="Count" pid="3"><vt:r8>8</vt:r8></property>'
    );
    await expect(
      mutateProperty(duplicate, "remove", { name: "Count" }, context)
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    const collision = await customImported(
      '<property name="title" pid="2"><vt:lpwstr>Custom</vt:lpwstr></property>'
    );
    await expect(
      mutateProperty(collision, "set", { name: "title", value: "Collision" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each(["i4", "int"])("retains imported %s integer bounds", async (tag) => {
    const source = await customImported(
      `<property name="Count" pid="2"><vt:${tag}>7</vt:${tag}></property>`
    );
    for (const value of [1.5, -2147483649, 2147483648])
      await expect(
        mutateProperty(source, "set", { name: "Count", value }, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
    for (const value of [-2147483648, 2147483647])
      expect(
        xml(
          (await mutateProperty(source, "set", { name: "Count", value }, context)).bytes,
          "docProps/custom.xml"
        )
      ).toContain(`<vt:${tag}>${value}</vt:${tag}>`);
  });
  it("repairs required date type annotation on an edited imported value", async () => {
    const source = await imported("<dcterms:created>2020-01-01T00:00:00Z</dcterms:created>");
    const changed = await mutateProperty(
      source,
      "set",
      { name: "created", value: "2021-01-01T00:00:00Z" },
      context
    );
    expect(xml(changed.bytes, "docProps/core.xml")).toContain(':type="dcterms:W3CDTF"');
  });
});

it("creates missing core metadata through the live getter and reloads all dates", async () => {
  const { parseXmlPart } = await import("./xml.js");
  const { openPropertySession } = await import("./properties.js");
  const source = await createPresentation({}, context);
  const members = inspectZip(source)
    .filter((e) => e.name !== "docProps/core.xml")
    .map((e) => {
      let bytes: Uint8Array = e.payload;
      if (e.name === "_rels/.rels" || e.name === "[Content_Types].xml") {
        let doc = parseXmlPart(bytes, context.xmlLimits);
        const index = doc.root.children.findIndex((n) =>
          n.attributes.some(
            (a) => a.value === "docProps/core.xml" || a.value === "/docProps/core.xml"
          )
        );
        doc = doc.spliceChildren(doc.root, index, 1, []);
        bytes = doc.bytes();
      }
      return { name: e.name, bytes };
    });
  const missing = await writePackageArchive(members, context, { compression: "store" });
  expect(await readProperties(missing, {}, context)).toEqual([]);
  const session = await openPropertySession(missing, context);
  expect(inspectZip(await session.save()).some((e) => e.name === "docProps/core.xml")).toBe(false);
  const props = session.core_properties;
  expect(props.author).toBe("");
  expect(props.created).toBeNull();
  for (const name of ["created", "modified", "last_printed"])
    Reflect.set(props, name, new Date("2024-06-07T08:09:10.789Z"));
  for (const name of strings) Reflect.set(props, name, "Original 😀 " + name);
  props.revision = 4;
  const saved = await session.save();
  const reopened = await openPropertySession(saved, context);
  for (const name of ["created", "modified", "last_printed"])
    expect((Reflect.get(reopened.core_properties, name) as Date).toISOString()).toBe(
      "2024-06-07T08:09:10.000Z"
    );
  for (const name of strings)
    expect(Reflect.get(reopened.core_properties, name)).toBe("Original 😀 " + name);
  expect(reopened.core_properties.revision).toBe(4);
  const doc = parseXmlPart(
    inspectZip(saved).find((e) => e.name === "docProps/core.xml")!.payload,
    context.xmlLimits
  );
  for (const local of ["created", "modified", "lastPrinted"]) {
    const node = doc.root.children.find((n) => n.name.localName === local)!;
    const annotation = node.attributes.find(
      (a) =>
        a.name.namespace === "http://www.w3.org/2001/XMLSchema-instance" &&
        a.name.localName === "type"
    );
    if (local === "lastPrinted") expect(annotation).toBeUndefined();
    else expect(annotation?.value).toBe("dcterms:W3CDTF");
  }
});

it("preserves unknown declared XML types at metadata sanitization boundaries", async () => {
  const source = await imported(
    '<dcterms:created xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="x:PrivateDate">2020-01-01T00:00:00Z</dcterms:created>'
  );
  expect((await readProperties(source, {}, context))[0]?.type).toBe("unknown");
  await expect(
    mutateProperty(source, "set", { name: "created", value: "2021-01-01T00:00:00Z" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
  expect(xml((await sanitizeProperties(source, context)).bytes, "docProps/core.xml")).toContain(
    'xsi:type="x:PrivateDate"'
  );
  const { openPropertySession } = await import("./properties.js");
  const session = await openPropertySession(source, context);
  expect(() => {
    session.core_properties.created = new Date("2021-01-01T00:00:00Z");
  }).toThrow(expect.objectContaining({ code: "unsupported-edit", phase: "validate-intent" }));
});
it("uses strict custom namespaces in an imported strict presentation", async () => {
  const source = await createPresentation({}, context);
  const strict = await writePackageArchive(
    inspectZip(source).map((e) => ({
      name: e.name,
      bytes: new TextEncoder().encode(
        new TextDecoder()
          .decode(e.payload)
          .split("http://schemas.openxmlformats.org/presentationml/2006/main")
          .join("http://purl.oclc.org/ooxml/presentationml/main")
          .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships")
          .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
          .split("http://schemas.openxmlformats.org/drawingml/2006/main")
          .join("http://purl.oclc.org/ooxml/drawingml/main")
      )
    })),
    context,
    { compression: "store" }
  );
  const result = await mutateProperty(
    strict,
    "set",
    { name: "Review", value: false, type: "boolean" },
    context
  );
  const markup = xml(result.bytes, "docProps/custom.xml");
  expect(markup).toContain("http://purl.oclc.org/ooxml/officeDocument/customProperties");
  expect(markup).toContain("http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes");
  expect(await readProperties(result.bytes, {}, context)).toMatchObject([
    { name: "Review", value: false, type: "boolean" }
  ]);
});
it.each(["\u0000", "\ud800", "\uffff"])(
  "rejects invalid XML text without host coercion %j",
  async (value) => {
    const source = await createPresentation({}, context);
    await expect(
      mutateProperty(source, "set", { name: "title", value }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    await expect(
      mutateProperty(source, "set", { name: value, type: "string", value: "" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  }
);

it("classifies edits to opaque custom values as unsupported and preserves input", async () => {
  const markup =
    '<property name="Opaque" pid="2"><vt:vector size="1" baseType="lpwstr"><vt:lpwstr>Retained</vt:lpwstr></vt:vector></property>';
  const source = await customImported(markup);
  const before = Uint8Array.from(source);
  await expect(
    mutateProperty(source, "set", { name: "Opaque", type: "string", value: "Changed" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
  expect(source).toEqual(before);
  expect(xml(source, "docProps/custom.xml")).toContain(markup);
  await expect(
    mutateProperty(source, "set", { name: "New", value: "Untyped" }, context)
  ).rejects.toMatchObject({ code: "invalid-value", phase: "usage" });
});
