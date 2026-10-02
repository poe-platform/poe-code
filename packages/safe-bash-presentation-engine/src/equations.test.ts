import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { inventoryEquations, validateAuthoredEquation } from "./equations.js";
import { parseXmlPart } from "./xml.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const math = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
const limits = { maxBytes: 16000, maxNodes: 300, maxDepth: 30 };
const bytes = (value: string) => new TextEncoder().encode(value);
const document = (value: string) => parseXmlPart(bytes(value), limits);
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 16000,
    maxTotalBytes: 65536,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 16000,
    chunkSize: 512
  },
  xmlLimits: limits,
  relationshipLimits: { maxBytes: 16000, maxParts: 32, maxRelationships: 64 }
};

it.each([math, "http://purl.oclc.org/ooxml/officeDocument/math"])(
  "extracts namespaced equations as standalone markup",
  (namespace) => {
    const xml = document(
      `<p xmlns:q="${namespace}" xmlns:a="${namespace === math ? drawing : "http://purl.oclc.org/ooxml/drawingml/main"}" xmlns:z="urn:future"><q:oMath><q:r><a:t>x &amp; y 🐚</a:t></q:r></q:oMath><z:oMath/></p>`
    );
    const [record] = inventoryEquations(xml);
    expect(inventoryEquations(xml)).toHaveLength(1);
    expect(record).toMatchObject({ text: "x & y 🐚", supported: true });
    expect(document(record!.omml).root.name.namespace).toBe(namespace);
  }
);
it("counts paragraph math once and inventories opaque extensions without dropping their markup", () => {
  const xml = document(
    `<p xmlns:m="${math}" xmlns:a="${drawing}" xmlns:v="urn:future"><m:oMathPara><m:oMath><m:r><a:t>z</a:t></m:r><v:proof value="keep"/></m:oMath></m:oMathPara></p>`
  );
  const records = inventoryEquations(xml);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ text: "z", supported: false });
  expect(records[0]!.omml).toContain('<v:proof value="keep"/>');
});
it.each([
  "<m:oMath><m:r><a:t>literal &lt; 4</a:t></m:r></m:oMath>",
  "<m:oMathPara><m:oMath><m:f><m:num><m:r><a:t>a</a:t></m:r></m:num><m:den><m:r><a:t>b</a:t></m:r></m:den></m:f></m:oMath></m:oMathPara>",
  "<m:oMath><m:sSup><m:e><m:r><a:t>x</a:t></m:r></m:e><m:sup><m:r><a:t>2</a:t></m:r></m:sup></m:sSup></m:oMath>"
])("admits structured caller math without evaluation", (body) => {
  const part = document(`<root xmlns:m="${math}" xmlns:a="${drawing}">${body}</root>`);
  const source = part.markup(part.root.children[0]!, true);
  expect(validateAuthoredEquation(bytes(source), limits)).toBe(source);
});
it.each([
  "<m:oMath/>",
  "<m:oMath><m:r/></m:oMath>",
  "<m:oMath><a:t>x</a:t></m:oMath>",
  "<m:oMath><m:f><m:den/></m:f></m:oMath>",
  "<m:oMath><m:r><a:t><m:r/></a:t></m:r></m:oMath>",
  '<m:oMath><m:r unexpected="1"><a:t>x</a:t></m:r></m:oMath>',
  "<m:oMath><m:future/></m:oMath>",
  "<m:oMath>stray<m:r><a:t>x</a:t></m:r></m:oMath>",
  "<m:oMath><m:r><a:t>x</a:t></m:r><?evaluate x?></m:oMath>"
])("rejects malformed or unsupported authored structures", (body) => {
  const xml = document(`<root xmlns:m="${math}" xmlns:a="${drawing}">${body}</root>`);
  expect(() =>
    validateAuthoredEquation(bytes(xml.markup(xml.root.children[0]!, true)), limits)
  ).toThrow();
});
it.each([
  `<!DOCTYPE m:oMath [<!ENTITY x "value">]><m:oMath xmlns:m="${math}" xmlns:a="${drawing}"><m:r><a:t>&x;</a:t></m:r></m:oMath>`,
  '<oMath xmlns="urn:impostor"><r><t>x</t></r></oMath>',
  `<m:oMath xmlns:m="${math}" xmlns:a="${drawing}"><m:r></m:oMath>`,
  `<m:oMath xmlns:m="${math}" xmlns:a="${drawing}"><m:r><a:t>x</a:t></m:r></m:oMath><extra/>`
])("rejects unsafe or invalid XML documents", (source) => {
  expect(() => validateAuthoredEquation(bytes(source), limits)).toThrow();
});
it("enforces caller XML resource limits", () => {
  expect(() =>
    validateAuthoredEquation(bytes(`<oMath xmlns="${math}"><r><t>x</t></r></oMath>`), {
      ...limits,
      maxNodes: 2
    })
  ).toThrow();
});
it("admits literal mathematical text runs used by presentation documents", () => {
  const source = `<m:oMath xmlns:m="${math}"><m:r><m:t xml:space="preserve"> 3 + 4 </m:t></m:r></m:oMath>`;
  expect(validateAuthoredEquation(bytes(source), limits)).toBe(source);
  expect(inventoryEquations(document(source))[0]).toMatchObject({
    text: " 3 + 4 ",
    supported: true
  });
});
it("inventories equation choices hidden by a shape-level picture fallback", async () => {
  const { createPresentation } = await import("./creation.js");
  const { readEquations } = await import("./equations.js");
  const { inspectZip } = await import("../tests/zip-reader.js");
  const { storedArchive } = await import("../tests/fixtures/archive.js");
  const { Volume } = await import("memfs");

  const source = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Equation", text: "Fallback", x: 0, y: 0, width: 100, height: 100 }] }
      ]
    },
    context
  );
  const members = inspectZip(source).map((entry) => {
    if (entry.name !== "ppt/slides/slide1.xml") return { name: entry.name, bytes: entry.payload };
    const xml = parseXmlPart(entry.payload, limits);
    const tree = xml.root.children
      .find((n) => n.name.localName === "cSld")!
      .children.find((n) => n.name.localName === "spTree")!;
    const shape = tree.children.find((n) => n.name.localName === "sp")!;
    const wrapper = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${drawing}" xmlns:m="${math}"><mc:Choice Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="2" name="Equation"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a14:m><m:oMath><m:r><m:t>hidden + 7</m:t></m:r></m:oMath></a14:m></a:p></p:txBody></p:sp></mc:Choice><mc:Fallback>${xml.markup(shape, true)}</mc:Fallback></mc:AlternateContent>`;
    return {
      name: entry.name,
      bytes: xml.spliceChildren(tree, tree.children.indexOf(shape), 1, [wrapper]).bytes()
    };
  });
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/equations.pptx", storedArchive(members));
  const records = await readEquations(
    new Uint8Array(volume.readFileSync("/equations.pptx") as Buffer),
    {},
    context
  );
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    text: "hidden + 7",
    location: { objectId: "2", owner: "/ppt/slides/slide1.xml" }
  });
});
it.each([
  [math, "http://purl.oclc.org/ooxml/drawingml/main"],
  ["http://purl.oclc.org/ooxml/officeDocument/math", drawing]
])("rejects authored text from a different XML dialect", (mathNamespace, drawingNamespace) => {
  const source = `<m:oMath xmlns:m="${mathNamespace}" xmlns:a="${drawingNamespace}"><m:r><a:t>x</a:t></m:r></m:oMath>`;
  expect(() => validateAuthoredEquation(bytes(source), limits)).toThrow();
  expect(inventoryEquations(document(source))[0]).toMatchObject({ text: "x", supported: false });
});
it.each([false, true])(
  "requires authored math to match the selected package dialect",
  async (strict) => {
    const { createPresentation } = await import("./creation.js");
    const { mutateEquations, readEquations } = await import("./equations.js");
    const { inspectZip } = await import("../tests/zip-reader.js");
    const { storedArchive } = await import("../tests/fixtures/archive.js");
    const { Volume } = await import("memfs");
    let source = await createPresentation(
      {
        slides: [
          { shapes: [{ name: "Formula", text: "Lead", x: 0, y: 0, width: 100, height: 100 }] }
        ]
      },
      context
    );
    if (strict)
      source = storedArchive(
        inspectZip(source).map((entry) => ({
          name: entry.name,
          bytes: bytes(
            new TextDecoder()
              .decode(entry.payload)
              .split("http://schemas.openxmlformats.org/presentationml/2006/main")
              .join("http://purl.oclc.org/ooxml/presentationml/main")
              .split(drawing)
              .join("http://purl.oclc.org/ooxml/drawingml/main")
              .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships")
              .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
          )
        }))
      );
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/source.pptx", source);
    const namespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : math;
    const opposite = strict ? math : "http://purl.oclc.org/ooxml/officeDocument/math";
    const options = {
      select: {
        kind: "slide" as const,
        position: { coordinateSystem: "one-based" as const, value: 1 }
      },
      shape: "Formula"
    };
    await expect(
      mutateEquations(
        source,
        "add",
        {
          ...options,
          file: bytes(`<m:oMath xmlns:m="${opposite}"><m:r><m:t>x</m:t></m:r></m:oMath>`)
        },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    const result = await mutateEquations(
      source,
      "add",
      {
        ...options,
        file: bytes(`<m:oMath xmlns:m="${namespace}"><m:r><m:t>x</m:t></m:r></m:oMath>`)
      },
      context
    );
    const slideXml = new TextDecoder().decode(
      inspectZip(result.bytes).find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload
    );
    expect(slideXml).toContain(`<m:oMath xmlns:m="${namespace}">`);
    expect(slideXml).not.toContain(opposite);
    expect((await readEquations(result.bytes, {}, context))[0]).toMatchObject({
      text: "x",
      supported: true
    });
    expect(new Uint8Array(volume.readFileSync("/source.pptx") as Buffer)).toEqual(source);
  }
);
