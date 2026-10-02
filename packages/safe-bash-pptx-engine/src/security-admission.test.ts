import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDeckFixture } from "../tests/fixtures/decks.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
import { mutateProperty, openPropertySession, readProperties } from "./index.js";
import { parseXmlPart } from "./xml.js";

const context = {
  limits: { maxBytes: 200000, maxReads: 1000, chunkBytes: 65536 },
  archiveLimits: {
    maxArchiveBytes: 200000,
    maxEntryBytes: 50000,
    maxTotalBytes: 200000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 50000,
    chunkSize: 65536
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 60 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

function deck(
  part?: string,
  contentType = "application/octet-stream",
  protectedContent = false,
  payload = "<payload/>"
) {
  const { volume, root } = createDeckFixture("seed-library");
  if (part) {
    const path = `${root}${part}`;
    volume.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    volume.writeFileSync(path, payload);
    const pathTypes = `${root}/[Content_Types].xml`;
    const types = parseXmlPart(
      new Uint8Array(volume.readFileSync(pathTypes) as Buffer),
      context.xmlLimits
    );
    volume.writeFileSync(
      pathTypes,
      types
        .spliceChildren(types.root, types.root.children.length, 0, [
          `<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="${contentType}"/>`
        ])
        .bytes()
    );
  }
  if (protectedContent) {
    const path = `${root}/ppt/presentation.xml`;
    const xml = parseXmlPart(
      new Uint8Array(volume.readFileSync(path) as Buffer),
      context.xmlLimits
    );
    volume.writeFileSync(
      path,
      xml
        .spliceChildren(xml.root, xml.root.children.length, 0, [
          `<p:modifyVerifier xmlns:p="${xml.root.name.namespace}" cryptProviderType="rsaAES"/>`
        ])
        .bytes()
    );
  }
  return storedArchive(
    Object.entries(volume.toJSON())
      .filter(([, value]) => value !== null)
      .map(([path]) => ({
        name: path.slice(root.length + 1),
        bytes: new Uint8Array(volume.readFileSync(path) as Buffer)
      }))
  );
}

describe("shared mutation security admission", () => {
  it.each([
    ["disguised macro binary", "/payload.bin", "application/vnd.ms-office.vbaProject"],
    [
      "macro-enabled orphan",
      "/payload.xml",
      "application/vnd.ms-powerpoint.slide.macroEnabled.main+xml"
    ],
    ["macro part name", "/ppt/vbaProject.bin", "application/octet-stream"],
    ["mixed-case macro part name", "/ppt/VBAPROJECT.BIN", "application/octet-stream"],
    [
      "orphan signature",
      "/seal.xml",
      "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"
    ],
    [
      "orphan signature origin",
      "/origin.bin",
      "application/vnd.openxmlformats-package.digital-signature-origin"
    ],
    [
      "orphan signature certificate",
      "/certificate.bin",
      "application/vnd.openxmlformats-package.digital-signature-certificate"
    ],
    ["signature directory", "/_xmlsignatures/incomplete.bin", "application/octet-stream"]
  ])("rejects %s before public SDK property mutation", async (_name, part, type) => {
    const bytes = deck(part, type);
    const original = new Uint8Array(bytes);
    await expect(readProperties(bytes, {}, context)).resolves.toBeDefined();
    await expect(
      mutateProperty(bytes, "set", { name: "title", value: "Changed" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
    await expect(openPropertySession(bytes, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
    expect(bytes).toEqual(original);
  });

  it("retains the protected presentation rejection", async () => {
    await expect(
      mutateProperty(
        deck(undefined, undefined, true),
        "set",
        { name: "title", value: "Changed" },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });

  it.each([
    [
      "classification content type",
      "/classification.xml",
      "application/vnd.ms-office.classificationlabels+xml",
      "<labels/>"
    ],
    [
      "parameterized classification content type",
      "/classification.xml",
      "APPLICATION/VND.MS-OFFICE.CLASSIFICATIONLABELS+XML;charset=utf-8",
      "<labels/>"
    ],
    ["classification part name", "/docMetadata/LabelInfo.xml", "application/xml", "<labels/>"],
    [
      "custom sensitivity property",
      "/docProps/custom.xml",
      "application/vnd.openxmlformats-officedocument.custom-properties+xml",
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property name="MSIP_Label_564705aa-810c-48b9-80fd-765def135724_Enabled" pid="2" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"><vt:bool xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">true</vt:bool></property></Properties>'
    ]
  ])("rejects %s without attempting rights removal", async (_name, part, type, payload) => {
    const bytes = deck(part, type, false, payload);
    await expect(
      mutateProperty(bytes, "set", { name: "title", value: "Changed" }, context).then(
        () => "mutated"
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });

  it("does not treat an ordinary custom label property as rights metadata", async () => {
    const payload =
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property name="label" pid="2"><value>Seed packets</value></property></Properties>';
    const result = await mutateProperty(
      deck(
        "/docProps/custom.xml",
        "application/vnd.openxmlformats-officedocument.custom-properties+xml",
        false,
        payload
      ),
      "set",
      { name: "title", value: "Allowed" },
      context
    );
    expect(
      new TextDecoder().decode(
        inspectZip(result.bytes).find((entry) => entry.name === "docProps/custom.xml")!.payload
      )
    ).toBe(payload);
  });

  it.each([1, 64, 0x2000])("rejects ZIP encryption flag %i before SDK mutation", async (flag) => {
    const bytes = deck();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = view.getUint32(bytes.length - 6, true);
    view.setUint16(6, 0x800 | flag, true);
    view.setUint16(central + 8, 0x800 | flag, true);
    await expect(
      mutateProperty(bytes, "set", { name: "title", value: "Changed" }, context)
    ).rejects.toMatchObject({ code: "invalid-archive" });
  });

  it("preserves an ordinary orphan binary during a permitted property edit", async () => {
    const result = await mutateProperty(
      deck("/payload.bin"),
      "set",
      { name: "title", value: "Allowed" },
      context
    );
    const entries = inspectZip(result.bytes);
    expect(
      new TextDecoder().decode(entries.find((entry) => entry.name === "payload.bin")!.payload)
    ).toBe("<payload/>");
    expect(
      new TextDecoder().decode(entries.find((entry) => entry.name === "docProps/core.xml")!.payload)
    ).toContain(">Allowed<");
  });
});
