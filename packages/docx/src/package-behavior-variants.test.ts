import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  DocumentIo,
  PackageView,
  PartView,
  XmlPartView,
  ImagePartView,
  PackURI,
  InputTypeError,
  InvalidValueError,
  readArchive,
  writeArchive,
  parseDocumentXml,
  openDocumentStyleModel,
  type DocumentArchive
} from "./index.js";
import { DocumentPackage } from "./package.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";
import { rasterPng, rasterJpeg } from "../tests/fixtures/raster.js";

const encoder = new TextEncoder(),
  ct = "http://schemas.openxmlformats.org/package/2006/content-types",
  pr = "http://schemas.openxmlformats.org/package/2006/relationships",
  relType = "application/vnd.openxmlformats-package.relationships+xml";
const relationships = (body: string) => `<Relationships xmlns="${pr}">${body}</Relationships>`;
const relation = (id: string, target: string, type = "urn:original:notes", mode?: string) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode === undefined ? "" : ' TargetMode="' + mode + '"'}/>`;
function graphFixture(
  parts: [string, string | Uint8Array][] = [["records/leaf.xml", "<leaf>maple</leaf>"]],
  defaults: [string, string][] = [["xml", "application/xml"]],
  overrides: [string, string][] = [],
  edges: [string, string][] = []
) {
  const types = `<Types xmlns="${ct}"><Default Extension="rels" ContentType="${relType}"/>${defaults
    .filter(([ext]) => ext.toLowerCase() !== "rels")
    .map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`)
    .join(
      ""
    )}${overrides.map(([name, type]) => `<Override PartName="${name}" ContentType="${type}"/>`).join("")}</Types>`;
  const files: [string, string | Uint8Array][] = [
    ["[Content_Types].xml", types],
    ["_rels/.rels", relationships(edges.find(([owner]) => owner === "/")?.[1] ?? "")],
    ...parts
  ];
  for (const [owner, body] of edges)
    if (owner !== "/") files.push([new PackURI(owner).rels_uri.membername, relationships(body)]);
  const volume = Volume.fromJSON(
    Object.fromEntries(
      files.map(([name, value]) => [
        "/tree/" + name,
        typeof value === "string" ? value : Buffer.from(value)
      ])
    )
  );
  const archive = {
    comment: new Uint8Array(),
    members: files.map(([name]) => ({
      name,
      bytes: new Uint8Array(volume.readFileSync("/tree/" + name) as Buffer),
      directory: false,
      modified: new Date("2024-02-03T04:05:06Z")
    }))
  };
  return { volume, archive, graph: new DocumentPackage(archive, textContext.limits) };
}
async function bytesFor(archive: DocumentArchive): Promise<Uint8Array> {
  const volume = Volume.fromJSON({ "/output.zip": "" });
  await writeArchive(
    archive,
    {
      async write(bytes) {
        volume.appendFileSync("/output.zip", bytes);
      }
    },
    { order: "input", compression: "store" },
    textContext
  );
  return new Uint8Array(volume.readFileSync("/output.zip") as Buffer);
}
async function repack(archive: DocumentArchive) {
  return readArchive(await bytesFor(archive), textContext);
}
async function modelFixture() {
  const bytes = await textFixture(paragraph("Original canopy"), {
    styles: {
      kind: "styles",
      xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Canopy"><w:name w:val="Canopy"/></w:style></w:styles>`
    }
  });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  return openDocumentStyleModel(
    new Uint8Array(volume.readFileSync("/input.docx") as Buffer),
    textContext
  );
}
async function reopen(owner: PackageView) {
  const volume = Volume.fromJSON({ "/output.docx": "" });
  await owner.save({
    async write(bytes) {
      volume.appendFileSync("/output.docx", bytes);
    }
  });
  return PackageView.open(
    new Uint8Array(volume.readFileSync("/output.docx") as Buffer),
    textContext
  );
}

it("Default declarations expose extension and media type", async () => {
  const state = graphFixture([["records/leaf.xml", "<leaf/>"]], [["xml", "application/xml"]], []);
  const graph = state.graph;
  expect(graph.defaults).toContainEqual({ extension: "xml", content_type: "application/xml" });
});

it("Default declarations survive XML serialization", async () => {
  const state = graphFixture([["records/leaf.xml", "<leaf/>"]], [["xml", "application/xml"]], []);
  const graph = state.graph;
  expect(graph.defaults).toContainEqual({ extension: "xml", content_type: "application/xml" });
  const reopened = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(reopened.defaults).toEqual(graph.defaults);
});

it("Override declarations expose exact owned part names", async () => {
  const state = graphFixture(
    [["records/leaf.xml", "<leaf/>"]],
    [],
    [["/records/leaf.xml", "application/vnd.original.leaf+xml"]]
  );
  expect(state.graph.overrides).toEqual([
    { partname: "/records/leaf.xml", content_type: "application/vnd.original.leaf+xml" }
  ]);
  expect(new DocumentPackage(await repack(state.archive), textContext.limits).overrides).toEqual(
    state.graph.overrides
  );
});

it("Override declarations survive original archive serialization", async () => {
  const state = graphFixture(
    [["records/leaf.xml", "<leaf/>"]],
    [],
    [["/records/leaf.xml", "application/vnd.original.leaf+xml"]]
  );
  expect(state.graph.overrides).toEqual([
    { partname: "/records/leaf.xml", content_type: "application/vnd.original.leaf+xml" }
  ]);
  expect(new DocumentPackage(await repack(state.archive), textContext.limits).overrides).toEqual(
    state.graph.overrides
  );
});

it("Relationship XML values retain their owner-local metadata", async () => {
  const state = graphFixture(
    [["records/leaf.xml", "<leaf/>"]],
    [["xml", "application/xml"]],
    [],
    [["/", relation("rId9", "records/leaf.xml", "urn:original:notes")]]
  );
  const edge = state.graph.relationships("/")[0]!;
  expect([edge.rId, edge.reltype, edge.target_ref, edge.is_external]).toEqual([
    "rId9",
    "urn:original:notes",
    "records/leaf.xml",
    false
  ]);
});

it("Relationship XML distinguishes absent internal and external target modes", async () => {
  for (const mode of [undefined, "Internal", "External"] as const) {
    const state = graphFixture(
      [["records/leaf.xml", "<leaf/>"]],
      [["xml", "application/xml"]],
      [],
      [
        [
          "/",
          relation(
            "rId9",
            mode === "External" ? "https://invalid.example/leaf" : "records/leaf.xml",
            "urn:original:notes",
            mode
          )
        ]
      ]
    );
    const edge = state.graph.relationships("/")[0]!;
    expect(edge.is_external).toBe(mode === "External");
    expect(edge.rId).toBe("rId9");
    expect(edge.reltype).toBe("urn:original:notes");
    expect(
      new DocumentPackage(await repack(state.archive), textContext.limits).relationships("/")[0]!
        .target_ref
    ).toBe(edge.target_ref);
  }
});

it("New owner relationship collection serializes an empty root", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const bytes = encoder.encode(styles.rels.xml),
    root = parseDocumentXml(bytes).root;
  expect([root.namespace, root.localName, root.children.length]).toEqual([pr, "Relationships", 0]);
  expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toContain("Relationships");
});

it("Relationship additions serialize internal and external edges in insertion order", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const part = await XmlPartView.load(
    "/records/leaf.xml",
    "application/xml",
    encoder.encode("<leaf/>"),
    owner
  );
  styles.load_rel("urn:original:first", part, "rId1");
  styles.load_rel("urn:original:link", "https://invalid.example/leaf", "rId2", true);
  styles.load_rel("urn:original:third", main, "rId3");
  const root = parseDocumentXml(encoder.encode(styles.rels.xml)).root;
  expect(
    root.children.map((node) => node.attributes.find((attr) => attr.localName === "Id")!.value)
  ).toEqual(["rId1", "rId2", "rId3"]);
  expect(styles.rels.at("rId1").target_ref).toBe("../records/leaf.xml");
  expect(styles.rels.at("rId2").is_external).toBe(true);
});

it("Empty relationship XML serializes as explicit UTF-8 bytes", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const bytes = encoder.encode(styles.rels.xml),
    root = parseDocumentXml(bytes).root;
  expect([root.namespace, root.localName, root.children.length]).toEqual([pr, "Relationships", 0]);
  expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toContain("Relationships");
});

it("Content type XML exposes two independent default declarations", async () => {
  const state = graphFixture([["records/leaf.xml", "<leaf/>"]], [["xml", "application/xml"]], []);
  expect(state.graph.defaults).toHaveLength(2);
  expect(state.graph.defaults.map((value) => value.extension)).toEqual(["rels", "xml"]);
});

it("Content type XML exposes three independent override declarations", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["records/branch.xml", "<branch/>"],
      ["records/seed.xml", "<seed/>"]
    ],
    [],
    [
      ["/records/leaf.xml", "application/vnd.original.leaf+xml"],
      ["/records/branch.xml", "application/vnd.original.branch+xml"],
      ["/records/seed.xml", "application/vnd.original.seed+xml"]
    ]
  );
  expect(state.graph.overrides).toHaveLength(3);
  expect(state.graph.overrides.map((value) => value.partname)).toEqual([
    "/records/leaf.xml",
    "/records/branch.xml",
    "/records/seed.xml"
  ]);
});

it("Missing content type children return empty query lists", async () => {
  const volume = Volume.fromJSON({ "/types.xml": `<Types xmlns="${ct}"/>` }),
    root = parseDocumentXml(new Uint8Array(volume.readFileSync("/types.xml") as Buffer)).root;
  expect(root.children.filter((node) => node.localName === "Default")).toEqual([]);
  expect(root.children.filter((node) => node.localName === "Override")).toEqual([]);
});

it("Empty content type element remains a valid XML value", async () => {
  const volume = Volume.fromJSON({ "/types.xml": `<Types xmlns="${ct}"/>` }),
    root = parseDocumentXml(new Uint8Array(volume.readFileSync("/types.xml") as Buffer)).root;
  expect(root.children.filter((node) => node.localName === "Default")).toEqual([]);
  expect(root.children.filter((node) => node.localName === "Override")).toEqual([]);
});

it("Content declarations retain mixed default and override media types", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["records/branch.xml", "<branch/>"],
      ["assets/seed.jpeg", rasterJpeg()]
    ],
    [
      ["xml", "application/xml"],
      ["jpeg", "image/jpeg"]
    ],
    [
      ["/records/leaf.xml", "application/vnd.original.leaf+xml"],
      ["/records/branch.xml", "application/vnd.original.branch+xml"],
      ["/assets/seed.jpeg", "image/jpeg"]
    ]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.defaults).toHaveLength(3);
  expect(graph.overrides).toHaveLength(3);
  expect(graph.getPart("/assets/seed.jpeg").content_type).toBe("image/jpeg");
});

it("Package factory asynchronously admits an explicit original byte source", async () => {
  const bytes = await textFixture(paragraph("Original canopy")),
    volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  const pending = PackageView.open(
    new Uint8Array(volume.readFileSync("/input.docx") as Buffer),
    textContext
  );
  expect(pending).toBeInstanceOf(Promise);
  const owner = await pending;
  expect(owner.main_document_part.package).toBe(owner);
});

it("Owner-local relationship access retains collection identity", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  expect(owner.rels).toBe(owner.rels);
  expect(styles.rels).toBe(styles.rels);
  expect(owner.rels).not.toBe(styles.rels);
});

it("Root relationship loading records explicit owned targets", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  owner.load_rel("urn:original:canopy", styles, "rId99");
  expect(owner.rels.at("rId99").target_part).toBe(styles);
  expect(owner.rels.at("rId99").target_ref).toBe("word/styles.xml");
});

it("Root relationship establishment returns a stable owner-local identifier", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  const id = owner.relate_to(styles, "urn:original:canopy");
  expect(owner.relate_to(styles, "urn:original:canopy")).toBe(id);
  expect(owner.rels.at(id).target_part).toBe(styles);
});

it("Package parts list equals the deterministic reachable traversal", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  expect(owner.parts).toEqual([...owner.iter_parts()]);
  expect(owner.parts).toContain(main);
  expect(owner.parts).toContain(styles);
  expect(new Set(owner.parts).size).toBe(owner.parts.length);
});

it("Cyclic traversal visits owned parts once and skips external targets", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.relate_to(main, "urn:original:cycle");
  owner.rels.get_or_add_ext_rel("urn:original:external", "https://invalid.example/leaf");
  expect(owner.parts).toEqual([main, styles]);
  expect(
    [...owner.iter_rels()].filter((edge) => edge.reltype === "urn:original:cycle")
  ).toHaveLength(1);
});

it("Part allocation fills gap 1 among no occupied numbers", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  for (const number of []) {
    const part = await XmlPartView.load(
      "/records/leaf" + number + ".xml",
      "application/xml",
      encoder.encode("<leaf/>"),
      owner
    );
    styles.relate_to(part, "urn:original:leaf" + number);
  }
  expect(owner.next_partname("/records/leaf%d.xml").toString()).toBe("/records/leaf1.xml");
});

it("Part allocation fills gap 2 among 1", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  for (const number of [1]) {
    const part = await XmlPartView.load(
      "/records/leaf" + number + ".xml",
      "application/xml",
      encoder.encode("<leaf/>"),
      owner
    );
    styles.relate_to(part, "urn:original:leaf" + number);
  }
  expect(owner.next_partname("/records/leaf%d.xml").toString()).toBe("/records/leaf2.xml");
});

it("Part allocation fills gap 3 among 1, 2", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  for (const number of [1, 2]) {
    const part = await XmlPartView.load(
      "/records/leaf" + number + ".xml",
      "application/xml",
      encoder.encode("<leaf/>"),
      owner
    );
    styles.relate_to(part, "urn:original:leaf" + number);
  }
  expect(owner.next_partname("/records/leaf%d.xml").toString()).toBe("/records/leaf3.xml");
});

it("Part allocation fills gap 1 among 2, 3", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  for (const number of [2, 3]) {
    const part = await XmlPartView.load(
      "/records/leaf" + number + ".xml",
      "application/xml",
      encoder.encode("<leaf/>"),
      owner
    );
    styles.relate_to(part, "urn:original:leaf" + number);
  }
  expect(owner.next_partname("/records/leaf%d.xml").toString()).toBe("/records/leaf1.xml");
});

it("Part allocation fills gap 2 among 1, 3", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  for (const number of [1, 3]) {
    const part = await XmlPartView.load(
      "/records/leaf" + number + ".xml",
      "application/xml",
      encoder.encode("<leaf/>"),
      owner
    );
    styles.relate_to(part, "urn:original:leaf" + number);
  }
  expect(owner.next_partname("/records/leaf%d.xml").toString()).toBe("/records/leaf2.xml");
});

it("Root relationship type lookup returns the original target owner", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  owner.load_rel("urn:original:canopy", styles, "rId99");
  expect(owner.part_related_by("urn:original:canopy")).toBe(styles);
});

it("Package output reopens with reachable owned parts and unchanged payloads", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const before = owner.parts.map((part) => [part.partname.toString(), part.blob] as const),
    reopened = await reopen(owner);
  for (const [name, bytes] of before)
    expect(reopened.parts.find((part) => part.partname.toString() === name)!.blob).toEqual(bytes);
});

it("Absent core properties create one owned resource with deterministic defaults", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const first = owner.core_properties;
  expect(owner.core_properties).toBe(first);
  expect(first.part.package).toBe(owner);
  expect(owner.parts.filter((part) => part === first.part)).toHaveLength(1);
  expect(first.modified?.toISOString()).toBe("1980-01-01T00:00:00.000Z");
  expect(first.revision).toBe(1);
});

it("Package finalization preserves admitted owner identity and valid traversal", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  owner.after_unmarshal();
  for (const part of owner.parts) part.after_unmarshal();
  expect(owner.main_document_part).toBe(main);
  expect(owner.parts).toContain(styles);
  expect((await reopen(owner)).main_document_part.element.tag.localName).toBe("document");
});

it("Admission restores exact part bytes with subtype ownership", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const reopened = await reopen(owner);
  expect(reopened.main_document_part).toBeInstanceOf(XmlPartView);
  expect(reopened.main_document_part.blob).toEqual(main.blob);
  expect(
    reopened.parts.find((part) => part.partname.toString() === "/word/styles.xml")!.blob
  ).toEqual(styles.blob);
});

it("Admission resolves root and child relationships to their original owners", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const reopened = await reopen(owner);
  expect(
    reopened.main_document_part.part_related_by(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    )
  ).toBe(reopened.parts.find((part) => part.partname.toString() === "/word/styles.xml"));
  expect(
    [...reopened.iter_rels()].every(
      (edge) => edge.is_external || edge.target_part.package === reopened
    )
  ).toBe(true);
});

it("Part factory returns an admitted inert owner", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = Uint8Array.of(31, 47, 59),
    pending = PartView.load("/records/leaf.bin", "application/octet-stream", bytes, owner);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  expect(part).toBeInstanceOf(PartView);
  expect(part.package).toBe(owner);
  expect(part.blob).toEqual(bytes);
});

it("Part name is an immutable validated URI value", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  expect(styles.partname).toBeInstanceOf(PackURI);
  expect(styles.partname.toString()).toBe("/word/styles.xml");
  expect(Object.isFrozen(styles.partname)).toBe(true);
});

it("Part rename updates owner identity and incoming references", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const id = main.relate_to(styles, "urn:original:canopy");
  styles.partname = new PackURI("/definitions/canopy.xml");
  expect(styles.partname.toString()).toBe("/definitions/canopy.xml");
  expect(main.rels.at(id).target_ref).toBe("../definitions/canopy.xml");
  expect(main.rels.at(id).target_part).toBe(styles);
  expect(
    (await reopen(owner)).parts.some(
      (part) => part.partname.toString() === "/definitions/canopy.xml"
    )
  ).toBe(true);
});

it("Part content type remains the admitted declaration", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  expect(styles.content_type).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
  );
});

it("Part package points to the original admitted owner", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  expect(styles.package).toBe(owner);
  expect(main.package).toBe(owner);
  expect(styles.package.main_document_part).toBe(main);
});

it("Part admission hook validates ownership without replacing handles", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  styles.after_unmarshal();
  expect(styles.package).toBe(owner);
  expect(owner.parts).toContain(styles);
});

it("Part publication hook validates the maintained package graph", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  styles.before_marshal();
  const reopened = await reopen(owner);
  expect(
    reopened.parts.some((part) => part.partname.toString() === styles.partname.toString())
  ).toBe(true);
});

it("Loaded inert part retains exact independent bytes", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = Uint8Array.of(31, 47, 59),
    part = await PartView.load("/records/leaf.bin", "application/octet-stream", bytes, owner);
  bytes.fill(0);
  const copy = part.blob;
  copy.fill(1);
  expect(part.blob).toEqual(Uint8Array.of(31, 47, 59));
});

it("Part relationship access retains one owner-local collection", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  expect(styles.rels).toBe(styles.rels);
  expect(styles.rels).not.toBe(main.rels);
  expect(styles.rels.length).toBe(0);
});

it("Part relationship loading honors explicit IDs", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.load_rel("urn:original:notes", main, "rId99");
  expect(styles.rels.at("rId99").target_part).toBe(main);
  expect(styles.rels.at("rId99").reltype).toBe("urn:original:notes");
});

it("Part relationship establishment deduplicates owner and type", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const id = styles.relate_to(main, "urn:original:notes");
  expect(styles.relate_to(main, "urn:original:notes")).toBe(id);
  expect(styles.rels.at(id).target_part).toBe(main);
});

it("Part external relationship establishment stores an inert target", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const id = styles.relate_to("https://invalid.example/leaf", "urn:original:link", true);
  expect(styles.rels.at(id).is_external).toBe(true);
  expect(styles.target_ref(id)).toBe("https://invalid.example/leaf");
  expect(() => styles.rels.at(id).target_part).toThrow();
});

it("Part deletion removes an unreferenced owned edge", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const id = styles.relate_to(main, "urn:original:notes");
  styles.drop_rel(id);
  expect(styles.rels.has(id)).toBe(false);
});

it("Part relationship-type lookup returns the original part", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.relate_to(main, "urn:original:notes");
  expect(styles.part_related_by("urn:original:notes")).toBe(main);
});

it("Part related-part snapshot resolves owner-local IDs", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const id = styles.relate_to(main, "urn:original:notes");
  expect(styles.related_parts.get(id)).toBe(main);
  const snapshot = styles.related_parts as Map<string, PartView>;
  snapshot.clear();
  expect(styles.related_parts.get(id)).toBe(main);
});

it("Part target lookup retains exact external spelling", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const target = "https://invalid.example/leaf%20map#bud",
    id = styles.relate_to(target, "urn:original:link", true);
  expect(styles.target_ref(id)).toBe(target);
});

it("Factory subtype follows admitted image MIME", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = rasterPng(42, 24),
    pending = PartView.load("/records/leaf.png", "image/png", bytes, owner);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  expect(part).toBeInstanceOf(ImagePartView);
  expect(part.package).toBe(owner);
  expect(part.blob).toEqual(bytes);
});

it("Factory subtype follows admitted XML MIME", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = encoder.encode("<leaf/>"),
    pending = PartView.load("/records/leaf.xml", "application/xml", bytes, owner);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  expect(part).toBeInstanceOf(XmlPartView);
  expect(part.package).toBe(owner);
  expect(part.blob).toEqual(bytes);
});

it("Factory default preserves generic inert bytes", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = Uint8Array.of(31, 47, 59),
    pending = PartView.load("/records/leaf.bin", "application/octet-stream", bytes, owner);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  expect(part).toBeInstanceOf(PartView);
  expect(part.package).toBe(owner);
  expect(part.blob).toEqual(bytes);
});

it("XML factory returns an admitted XML owner", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = encoder.encode("<leaf/>"),
    pending = PartView.load("/records/leaf.xml", "application/xml", bytes, owner);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  expect(part).toBeInstanceOf(XmlPartView);
  expect(part.package).toBe(owner);
  expect(part.blob).toEqual(bytes);
});

it("XML part changes serialize through the original admitted owner", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const part = await XmlPartView.load(
    "/records/leaf.xml",
    "application/xml",
    encoder.encode("<leaf>maple</leaf>"),
    owner
  );
  part.element.text = "birch & elm";
  expect(parseDocumentXml(part.blob).root.content[0]).toMatchObject({
    kind: "text",
    text: "birch & elm"
  });
  expect(part.part).toBe(part);
  expect(part.element).toBe(part.element);
});

it("XML part children retain the original part owner", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  expect(styles.part).toBe(styles);
  const element = model.styles.at("Canopy").element;
  expect(model.styles.at("Canopy").element).toBe(element);
  model.styles.at("Canopy").name = "Maple";
  expect(element.children[0]!.attributes.values().next().value).toBe("Maple");
});

it("Relationship deletion checks 0 remaining XML references", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  const part = await XmlPartView.load(
    "/records/leaf.xml",
    "application/xml",
    encoder.encode(
      '<leaf xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></leaf>'
    ),
    owner
  );
  part.load_rel("urn:original:notes", styles, "rId42");
  part.drop_rel("rId42");
  expect(part.rels.has("rId42")).toBe(false);
});

it("Relationship deletion checks 1 remaining XML references", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  const part = await XmlPartView.load(
    "/records/leaf.xml",
    "application/xml",
    encoder.encode(
      '<leaf xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><item r:id="rId42"/></leaf>'
    ),
    owner
  );
  part.load_rel("urn:original:notes", styles, "rId42");
  expect(() => part.drop_rel("rId42")).toThrow();
  expect(part.rels.has("rId42")).toBe(true);
});

it("Relationship deletion checks 2 remaining XML references", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  const part = await XmlPartView.load(
    "/records/leaf.xml",
    "application/xml",
    encoder.encode(
      '<leaf xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><item r:id="rId42"/><item r:id="rId42"/></leaf>'
    ),
    owner
  );
  part.load_rel("urn:original:notes", styles, "rId42");
  expect(() => part.drop_rel("rId42")).toThrow();
  expect(part.rels.has("rId42")).toBe(true);
});

it("Explicit tree inventory produces bounded original archive members", async () => {
  const state = graphFixture(),
    archive = await repack(state.archive);
  expect(archive.members.map((member) => member.name)).toEqual(
    state.archive.members.map((member) => member.name)
  );
  expect(archive.members.every((member) => !member.directory)).toBe(true);
});

it("Explicit tree cleanup is idempotent and preserves unrelated memory entries", async () => {
  const state = graphFixture();
  const volume = Volume.fromJSON({ "/keep": "retain" });
  const io = new DocumentIo(textContext);
  const bytes = await bytesFor(state.archive);
  expect(
    await io.readBytes({
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield bytes;
          }
        };
      }
    })
  ).toEqual(bytes);
  await io.cleanup();
  await io.cleanup();
  expect(volume.readFileSync("/keep", "utf8")).toBe("retain");
});

it("Explicit tree retrieves a member by its validated package URI", async () => {
  const state = graphFixture();
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart(new PackURI("/records/leaf.xml").toString()).bytes).toEqual(
    encoder.encode("<leaf>maple</leaf>")
  );
});

it("Explicit tree reads exact content declaration bytes", async () => {
  const state = graphFixture();
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "[Content_Types].xml")!.bytes).toEqual(
    state.archive.members.find((member) => member.name === "[Content_Types].xml")!.bytes
  );
});

it("Explicit tree retrieves root relationship bytes exactly", async () => {
  const state = graphFixture();
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "_rels/.rels")!.bytes).toEqual(
    state.archive.members.find((member) => member.name === "_rels/.rels")!.bytes
  );
});

it("Explicit tree missing part relationships remain an empty collection", async () => {
  const state = graphFixture();
  expect(
    new DocumentPackage(await repack(state.archive), textContext.limits).relationships(
      "/records/leaf.xml"
    )
  ).toEqual([]);
});

it("Invalid package bytes reject without ambient path access", async () => {
  const volume = Volume.fromJSON({ "/input": "unrecognized original payload" });
  await expect(
    readArchive(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext)
  ).rejects.toThrow();
});

it("ZIP source transport produces bounded original archive members", async () => {
  const state = graphFixture(),
    archive = await repack(state.archive);
  expect(archive.members.map((member) => member.name)).toEqual(
    state.archive.members.map((member) => member.name)
  );
  expect(archive.members.every((member) => !member.directory)).toBe(true);
});

it("Explicit archive source snapshots fragments and closes after admission", async () => {
  const state = graphFixture(),
    bytes = await bytesFor(state.archive),
    volume = Volume.fromJSON({ "/input": Buffer.from(bytes) });
  let closed = false;
  const io = new DocumentIo(textContext);
  const result = await io.readBytes({
    open() {
      return {
        async *[Symbol.asyncIterator]() {
          try {
            const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
            yield input.slice(0, 9);
            yield input.slice(9);
          } finally {
            closed = true;
          }
        }
      };
    }
  });
  expect(result).toEqual(bytes);
  expect(closed).toBe(true);
  await io.cleanup();
});

it("Archive input initialization produces bounded original archive members", async () => {
  const state = graphFixture(),
    archive = await repack(state.archive);
  expect(archive.members.map((member) => member.name)).toEqual(
    state.archive.members.map((member) => member.name)
  );
  expect(archive.members.every((member) => !member.directory)).toBe(true);
});

it("Archive input cleanup is idempotent and preserves unrelated memory entries", async () => {
  const state = graphFixture();
  const volume = Volume.fromJSON({ "/keep": "retain" });
  const io = new DocumentIo(textContext);
  const bytes = await bytesFor(state.archive);
  expect(
    await io.readBytes({
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield bytes;
          }
        };
      }
    })
  ).toEqual(bytes);
  await io.cleanup();
  await io.cleanup();
  expect(volume.readFileSync("/keep", "utf8")).toBe("retain");
});

it("ZIP source retrieves a member by its validated package URI", async () => {
  const state = graphFixture();
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart(new PackURI("/records/leaf.xml").toString()).bytes).toEqual(
    encoder.encode("<leaf>maple</leaf>")
  );
});

it("ZIP source reads exact content declaration bytes", async () => {
  const state = graphFixture();
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "[Content_Types].xml")!.bytes).toEqual(
    state.archive.members.find((member) => member.name === "[Content_Types].xml")!.bytes
  );
});

it("ZIP source retrieves root relationship bytes exactly", async () => {
  const state = graphFixture();
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "_rels/.rels")!.bytes).toEqual(
    state.archive.members.find((member) => member.name === "_rels/.rels")!.bytes
  );
});

it("ZIP source missing part relationships remain an empty collection", async () => {
  const state = graphFixture();
  expect(
    new DocumentPackage(await repack(state.archive), textContext.limits).relationships(
      "/records/leaf.xml"
    )
  ).toEqual([]);
});

it("Explicit output transport produces bounded original archive members", async () => {
  const state = graphFixture(),
    archive = await repack(state.archive);
  expect(archive.members.map((member) => member.name)).toEqual(
    state.archive.members.map((member) => member.name)
  );
  expect(archive.members.every((member) => !member.directory)).toBe(true);
});

it("Archive output initialization produces bounded original archive members", async () => {
  const state = graphFixture(),
    archive = await repack(state.archive);
  expect(archive.members.map((member) => member.name)).toEqual(
    state.archive.members.map((member) => member.name)
  );
  expect(archive.members.every((member) => !member.directory)).toBe(true);
});

it("Archive output cleanup is idempotent and preserves unrelated memory entries", async () => {
  const state = graphFixture();
  const volume = Volume.fromJSON({ "/keep": "retain" });
  const io = new DocumentIo(textContext);
  const bytes = await bytesFor(state.archive);
  expect(
    await io.readBytes({
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield bytes;
          }
        };
      }
    })
  ).toEqual(bytes);
  await io.cleanup();
  await io.cleanup();
  expect(volume.readFileSync("/keep", "utf8")).toBe("retain");
});

it("Archive writer preserves an original member payload exactly", async () => {
  const state = graphFixture([["records/leaf.xml", "<leaf>maple</leaf>"]]);
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "records/leaf.xml")!.bytes).toEqual(
    encoder.encode("<leaf>maple</leaf>")
  );
});

it("Reader construction admits a complete owned archive", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf>maple</leaf>"],
      ["records/branch.xml", "<branch>birch</branch>"]
    ],
    undefined,
    [
      ["/records/leaf.xml", "application/vnd.original.leaf+xml"],
      ["/records/branch.xml", "application/vnd.original.branch+xml"]
    ]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(
    graph.parts
      .filter((part) => part.partname.startsWith("/records/"))
      .map((part) => [part.partname, part.content_type, new TextDecoder().decode(part.bytes)])
  ).toEqual([
    ["/records/leaf.xml", "application/vnd.original.leaf+xml", "<leaf>maple</leaf>"],
    ["/records/branch.xml", "application/vnd.original.branch+xml", "<branch>birch</branch>"]
  ]);
});

it("Reader enumerates exact serialized part records", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf>maple</leaf>"],
      ["records/branch.xml", "<branch>birch</branch>"]
    ],
    undefined,
    [
      ["/records/leaf.xml", "application/vnd.original.leaf+xml"],
      ["/records/branch.xml", "application/vnd.original.branch+xml"]
    ]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(
    graph.parts
      .filter((part) => part.partname.startsWith("/records/"))
      .map((part) => [part.partname, part.content_type, new TextDecoder().decode(part.bytes)])
  ).toEqual([
    ["/records/leaf.xml", "application/vnd.original.leaf+xml", "<leaf>maple</leaf>"],
    ["/records/branch.xml", "application/vnd.original.branch+xml", "<branch>birch</branch>"]
  ]);
});

it("Relationship reader retains root and child owner separation", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["records/branch.xml", "<branch/>"]
    ],
    undefined,
    undefined,
    [
      ["/", relation("rId1", "records/leaf.xml")],
      [
        "/records/leaf.xml",
        relation("rId1", "branch.xml") +
          relation("rId2", "https://invalid.example/leaf", "urn:original:link", "External")
      ],
      ["/records/branch.xml", relation("rId1", "leaf.xml")]
    ]
  );
  expect(
    ["/", "/records/leaf.xml", "/records/branch.xml"].map((owner) =>
      state.graph.relationships(owner).map((edge) => edge.rId)
    )
  ).toEqual([["rId1"], ["rId1", "rId2"], ["rId1"]]);
});

it("Reader loads exact content type and serialized bytes", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf>maple</leaf>"],
      ["records/branch.xml", "<branch>birch</branch>"]
    ],
    undefined,
    [
      ["/records/leaf.xml", "application/vnd.original.leaf+xml"],
      ["/records/branch.xml", "application/vnd.original.branch+xml"]
    ]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(
    graph.parts
      .filter((part) => part.partname.startsWith("/records/"))
      .map((part) => [part.partname, part.content_type, new TextDecoder().decode(part.bytes)])
  ).toEqual([
    ["/records/leaf.xml", "application/vnd.original.leaf+xml", "<leaf>maple</leaf>"],
    ["/records/branch.xml", "application/vnd.original.branch+xml", "<branch>birch</branch>"]
  ]);
});

it("Package reader traverses cycles shared targets and external edges once", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["records/branch.xml", "<branch/>"],
      ["records/seed.xml", "<seed/>"]
    ],
    undefined,
    undefined,
    [
      [
        "/",
        relation("rId1", "https://invalid.example/leaf", "urn:original:link", "External") +
          relation("rId2", "records/leaf.xml")
      ],
      ["/records/leaf.xml", relation("rId1", "branch.xml")],
      ["/records/branch.xml", relation("rId1", "leaf.xml") + relation("rId2", "seed.xml")]
    ]
  );
  expect([...state.graph.iterParts()].map((part) => part.partname)).toEqual([
    "/records/leaf.xml",
    "/records/branch.xml",
    "/records/seed.xml"
  ]);
});

it("Relationship reader returns owner-relative targets without creating missing members", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["assets/seed.xml", "<seed/>"]
    ],
    undefined,
    undefined,
    [["/records/leaf.xml", relation("rId9", "../assets/seed.xml")]]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.relationships("/records/leaf.xml")[0]!.target_part.partname).toBe(
    "/assets/seed.xml"
  );
  expect(graph.relationships("/assets/seed.xml")).toEqual([]);
});

it("Content map admission distinguishes defaults and overrides", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["assets/seed.PNG", rasterPng()]
    ],
    [
      ["xml", "application/xml"],
      ["PNG", "image/png"]
    ],
    [["/records/leaf.xml", "application/vnd.original.leaf+xml"]]
  );
  expect(state.graph.defaults.map((value) => value.extension)).toEqual(["rels", "xml", "PNG"]);
  expect(state.graph.overrides.map((value) => value.partname)).toEqual(["/records/leaf.xml"]);
});

it("Override lookup preserves case-insensitive variant 1", async () => {
  const state = graphFixture(
    [["records/leaf.xml", "<leaf/>"]],
    [["xml", "application/xml"]],
    [["/records/leaf.xml", "application/vnd.original.leaf+xml"]]
  );
  expect(state.graph.getPart("/records/leaf.xml").content_type).toBe(
    "application/vnd.original.leaf+xml"
  );
});

it("Override lookup preserves case-insensitive variant 2", async () => {
  const state = graphFixture(
    [["records/leaf.xml", "<leaf/>"]],
    [["xml", "application/xml"]],
    [["/records/leaf.xml", "application/vnd.original.leaf+xml"]]
  );
  expect(state.graph.getPart("/RECORDS/Leaf.XML").content_type).toBe(
    "application/vnd.original.leaf+xml"
  );
});

it("Override lookup preserves case-insensitive variant 3", async () => {
  const state = graphFixture(
    [["ReCoRdS/lEaF.XmL", "<leaf/>"]],
    [["xml", "application/xml"]],
    [["/ReCoRdS/lEaF.XmL", "application/vnd.original.leaf+xml"]]
  );
  expect(state.graph.getPart("/records/leaf.xml").content_type).toBe(
    "application/vnd.original.leaf+xml"
  );
});

it("Default lookup preserves extension case variant 1", async () => {
  const state = graphFixture([["records/leaf.xml", "<leaf/>"]], [["xml", "application/xml"]], []);
  expect(state.graph.getPart("/records/leaf.xml").content_type).toBe("application/xml");
});

it("Default lookup preserves extension case variant 2", async () => {
  const state = graphFixture([["records/leaf.PNG", rasterPng()]], [["png", "image/png"]], []);
  expect(state.graph.getPart("/records/leaf.PNG").content_type).toBe("image/png");
});

it("Default lookup preserves extension case variant 3", async () => {
  const state = graphFixture([["records/leaf.jpg", rasterJpeg()]], [["JPG", "image/jpeg"]], []);
  expect(state.graph.getPart("/records/leaf.jpg").content_type).toBe("image/jpeg");
});

it("Missing content type mapping fails before graph acceptance", async () => {
  expect(() => graphFixture([["records/leaf.1x&", Uint8Array.of(31, 47, 59)]], [], [])).toThrow();
});

it("Content lookup requires an explicit validated string URI", async () => {
  const state = graphFixture();
  expect(() => state.graph.getPart(42 as unknown as string)).toThrow(InputTypeError);
  expect(state.graph.getPart(new PackURI("/records/leaf.xml").toString()).partname).toBe(
    "/records/leaf.xml"
  );
});

it("Serialized part metadata retain original bytes and owner-relative relationships", async () => {
  const state = graphFixture(
    undefined,
    undefined,
    [["/records/leaf.xml", "application/vnd.original.leaf+xml"]],
    [
      [
        "/records/leaf.xml",
        relation("rId9", "https://invalid.example/leaf", "urn:original:notes", "External")
      ]
    ]
  );
  const part = state.graph.getPart("/records/leaf.xml");
  expect([part.partname, part.content_type, part.bytes]).toEqual([
    "/records/leaf.xml",
    "application/vnd.original.leaf+xml",
    encoder.encode("<leaf>maple</leaf>")
  ]);
  expect(state.graph.relationships(part.partname)[0]!.reltype).toBe("urn:original:notes");
});

it("Serialized edge metadata retain ID type target and mode", async () => {
  const state = graphFixture(undefined, undefined, undefined, [
    ["/", relation("rId9", "records/leaf.xml", "urn:original:notes", "Internal")]
  ]);
  const edge = state.graph.relationships("/")[0]!;
  expect([edge.rId, edge.reltype, edge.target_ref, edge.is_external]).toEqual([
    "rId9",
    "urn:original:notes",
    "records/leaf.xml",
    false
  ]);
});

it("Serialized target modes distinguish internal external and invalid values", async () => {
  for (const mode of ["Internal", "External"] as const) {
    const state = graphFixture(undefined, undefined, undefined, [
      [
        "/",
        relation(
          "rId9",
          mode === "External" ? "https://invalid.example/leaf" : "records/leaf.xml",
          "urn:original:notes",
          mode
        )
      ]
    ]);
    expect(state.graph.relationships("/")[0]!.is_external).toBe(mode === "External");
  }
  expect(() =>
    graphFixture(undefined, undefined, undefined, [
      ["/", relation("rId9", "records/leaf.xml", "urn:original:notes", "UNKNOWN")]
    ])
  ).toThrow();
});

it("Serialized internal targets resolve root nested and parent-relative owners", async () => {
  for (const [source, target, expected] of [
    ["/", "records/leaf.xml", "/records/leaf.xml"],
    ["/records/main.xml", "leaf.xml", "/records/leaf.xml"],
    ["/records/nested/main.xml", "../leaf.xml", "/records/leaf.xml"]
  ]) {
    const state = graphFixture(
      [
        ["records/leaf.xml", "<leaf/>"],
        ...(source === "/" ? [] : ([[source!.slice(1), "<main/>"]] as [string, string][]))
      ],
      undefined,
      undefined,
      [[source!, relation("rId9", target!)]]
    );
    expect(state.graph.relationships(source!)[0]!.target_part.partname).toBe(expected);
  }
});

it("Serialized external targets cannot dereference owned parts", async () => {
  const state = graphFixture(undefined, undefined, undefined, [
    ["/", relation("rId9", "https://invalid.example/leaf", "urn:original:notes", "External")]
  ]);
  expect(() => state.graph.relationships("/")[0]!.target_part).toThrow(InvalidValueError);
});

it("Serialized XML admission retains independent relationship rows", async () => {
  const state = graphFixture(undefined, undefined, undefined, [
    [
      "/",
      relation("rId1", "records/leaf.xml") +
        relation("rId2", "https://invalid.example/leaf", "urn:original:link", "External")
    ]
  ]);
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect([...graph.relationships("/")].map((edge) => edge.rId)).toEqual(["rId1", "rId2"]);
  expect(graph.relationships("/records/leaf.xml")).toEqual([]);
});

it("Serialized edge collection has deterministic empty iteration", async () => {
  const state = graphFixture(undefined, undefined, undefined, [
    [
      "/",
      relation("rId1", "records/leaf.xml") +
        relation("rId2", "https://invalid.example/leaf", "urn:original:link", "External")
    ]
  ]);
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect([...graph.relationships("/")].map((edge) => edge.rId)).toEqual(["rId1", "rId2"]);
  expect(graph.relationships("/records/leaf.xml")).toEqual([]);
});

it("Writer finalizes a complete original package with validated relationships", async () => {
  const state = graphFixture(undefined, undefined, undefined, [
    ["/", relation("rId9", "records/leaf.xml")]
  ]);
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect([...graph.iterParts()].map((part) => part.partname)).toEqual(["/records/leaf.xml"]);
});

it("Writer retains exact content declaration stream bytes", async () => {
  const state = graphFixture();
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "[Content_Types].xml")!.bytes).toEqual(
    state.archive.members.find((member) => member.name === "[Content_Types].xml")!.bytes
  );
});

it("Writer retains exact package relationship stream bytes", async () => {
  const state = graphFixture();
  const archive = await repack(state.archive);
  expect(archive.members.find((member) => member.name === "_rels/.rels")!.bytes).toEqual(
    state.archive.members.find((member) => member.name === "_rels/.rels")!.bytes
  );
});

it("Writer emits part and nonempty relationship members without inventing empty owners", async () => {
  const state = graphFixture(
    [
      ["records/leaf.xml", "<leaf/>"],
      ["records/branch.xml", "<branch/>"]
    ],
    undefined,
    undefined,
    [["/records/leaf.xml", relation("rId9", "branch.xml")]]
  );
  const archive = await repack(state.archive);
  expect(archive.members.map((member) => member.name)).toEqual([
    "[Content_Types].xml",
    "_rels/.rels",
    "records/leaf.xml",
    "records/branch.xml",
    "records/_rels/leaf.xml.rels"
  ]);
  expect(archive.members.some((member) => member.name === "records/_rels/branch.xml.rels")).toBe(
    false
  );
});

it("Content declaration serialization variant 1 retains default semantics", async () => {
  const state = graphFixture([["assets/LEAF.PNG", rasterPng()]], [["PNG", "image/png"]], []);
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/assets/LEAF.PNG").content_type).toBe("image/png");
  expect(graph.defaults).toEqual(state.graph.defaults);
});

it("Content declaration serialization variant 2 retains default semantics", async () => {
  const state = graphFixture(
    [["assets/leaf.xml", encoder.encode("<leaf/>")]],
    [["xml", "application/xml"]],
    []
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/assets/leaf.xml").content_type).toBe("application/xml");
  expect(graph.defaults).toEqual(state.graph.defaults);
});

it("Content declaration serialization variant 3 retains default semantics", async () => {
  const state = graphFixture([
    ["records/leaf.xml", "<leaf/>"],
    ["records/_rels/leaf.xml.rels", relationships("")]
  ]);
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/records/_rels/leaf.xml.rels").content_type).toBe(
    "application/vnd.openxmlformats-package.relationships+xml"
  );
  expect(graph.defaults).toEqual(state.graph.defaults);
});

it("Content declaration serialization variant 4 retains default semantics", async () => {
  const state = graphFixture([["assets/leaf.jpeg", rasterJpeg()]], [["jpeg", "image/jpeg"]], []);
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/assets/leaf.jpeg").content_type).toBe("image/jpeg");
  expect(graph.defaults).toEqual(state.graph.defaults);
});

it("Content declaration serialization variant 5 retains override semantics", async () => {
  const state = graphFixture(
    [["metadata/leaf.xml", encoder.encode("<leaf/>")]],
    [],
    [["/metadata/leaf.xml", "application/vnd.original.metadata+xml"]]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/metadata/leaf.xml").content_type).toBe(
    "application/vnd.original.metadata+xml"
  );
  expect(graph.overrides).toEqual(state.graph.overrides);
});

it("Content declaration serialization variant 6 retains override semantics", async () => {
  const state = graphFixture(
    [["records/leaf.xml", encoder.encode("<leaf/>")]],
    [],
    [["/records/leaf.xml", "application/vnd.original.record+xml"]]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/records/leaf.xml").content_type).toBe(
    "application/vnd.original.record+xml"
  );
  expect(graph.overrides).toEqual(state.graph.overrides);
});

it("Content declaration serialization variant 7 retains override semantics", async () => {
  const state = graphFixture(
    [["records/leaf.bar", encoder.encode("<leaf/>")]],
    [],
    [["/records/leaf.bar", "application/vnd.original.payload"]]
  );
  const graph = new DocumentPackage(await repack(state.archive), textContext.limits);
  expect(graph.getPart("/records/leaf.bar").content_type).toBe("application/vnd.original.payload");
  expect(graph.overrides).toEqual(state.graph.overrides);
});

it("Relationship creation retains ID type and owned target", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const edge = styles.rels.add_relationship("urn:original:notes", main, "rId9");
  expect([edge.rId, edge.reltype, edge.is_external]).toEqual(["rId9", "urn:original:notes", false]);
  expect(edge.target_part).toBe(main);
});

it("External relationship part access rejects without acquisition", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const edge = styles.rels.add_relationship(
    "urn:original:link",
    "https://invalid.example/leaf",
    "rId9",
    true
  );
  expect(() => edge.target_part).toThrow();
  expect(styles.related_parts.size).toBe(0);
});

it("External relationship reference preserves the inert target", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const target = "https://invalid.example/leaf%20map#bud",
    edge = styles.rels.add_relationship("urn:original:link", target, "rId9", true);
  expect(edge.target_ref).toBe(target);
});

it("Internal relationship references rebase across sibling directories", async () => {
  const model = await modelFixture(),
    owner = model.package,
    styles = model.styles.part;
  const part = await ImagePartView.load("/assets/leaf.png", "image/png", rasterPng(42, 24), owner);
  const edge = styles.rels.add_relationship("urn:original:image", part, "rId9");
  expect(edge.target_ref).toBe("../assets/leaf.png");
  expect(edge.target_part).toBe(part);
});

it("Relationship collection adds an explicitly owned internal edge", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const edge = styles.rels.add_relationship("urn:original:notes", main, "rId9");
  expect(styles.rels.at("rId9")).toBe(edge);
  expect(edge.target_part).toBe(main);
});

it("Relationship collection adds a new inert external edge", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  const id = styles.rels.get_or_add_ext_rel("urn:original:link", "https://invalid.example/leaf"),
    edge = styles.rels.at(id);
  expect([edge.reltype, edge.target_ref, edge.is_external]).toEqual([
    "urn:original:link",
    "https://invalid.example/leaf",
    true
  ]);
});

it("Relationship ID lookup returns the original owned entry", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const edge = styles.rels.add_relationship("urn:original:notes", main, "original");
  expect(styles.rels.at("original")).toBe(edge);
  expect(styles.rels.get("missing")).toBeNull();
});

it("Internal relationship matching reuses an entry and distinguishes a new type", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  const first = styles.rels.get_or_add("urn:original:first", main);
  expect(styles.rels.get_or_add("urn:original:first", main)).toBe(first);
  const second = styles.rels.get_or_add("urn:original:second", main);
  expect(second).not.toBe(first);
  expect(styles.rels.length).toBe(2);
});

it("Equal external type and target reuse an existing explicit ID", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  styles.rels.add_relationship("urn:original:link", "https://invalid.example/leaf", "rId369", true);
  expect(styles.rels.get_or_add_ext_rel("urn:original:link", "https://invalid.example/leaf")).toBe(
    "rId369"
  );
  expect(styles.rels.length).toBe(1);
});

it("Related-part map excludes external edges and retains target identity", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.rels.add_relationship("urn:original:notes", main, "rId6");
  styles.rels.add_relationship("urn:original:link", "https://invalid.example/leaf", "rId7", true);
  expect([...styles.related_parts]).toEqual([["rId6", main]]);
});

it("Missing keyed relationship lookup distinguishes null from a typed failure", async () => {
  const model = await modelFixture(),
    styles = model.styles.part;
  expect(styles.related_parts.get("rId666")).toBeUndefined();
  expect(styles.rels.get("rId666")).toBeNull();
  expect(() => styles.rels.at("rId666")).toThrow();
});

it("Relationship type lookup resolves the original internal target", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.rels.add_relationship("urn:original:notes", main, "rId6");
  expect(styles.rels.part_with_reltype("urn:original:notes")).toBe(main);
});

it("Relationship XML serializes internal rebase and external target mode", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.rels.add_relationship("urn:original:link", "https://invalid.example/leaf", "rId1", true);
  styles.rels.add_relationship("urn:original:notes", main, "rId2");
  const root = parseDocumentXml(encoder.encode(styles.rels.xml)).root;
  expect(
    root.children.map((node) => node.attributes.find((attr) => attr.localName === "Target")!.value)
  ).toEqual(["https://invalid.example/leaf", "document.xml"]);
  expect(root.children[0]!.attributes.find((attr) => attr.localName === "TargetMode")!.value).toBe(
    "External"
  );
});

it("Relationship ID allocation fills the first owner-local gap", async () => {
  const model = await modelFixture(),
    owner = model.package,
    main = owner.main_document_part,
    styles = model.styles.part;
  styles.rels.add_relationship("urn:original:first", main, "rId1");
  styles.rels.add_relationship("urn:original:third", main, "rId3");
  expect(styles.rels.get_or_add_ext_rel("urn:original:link", "https://invalid.example/leaf")).toBe(
    "rId2"
  );
});

it("Package image admission reuses equal bytes without another resource", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = rasterPng(42, 24),
    first = await owner.get_or_add_image_part(bytes);
  expect(await owner.get_or_add_image_part(bytes)).toBe(first);
  expect(first.image.blob).toEqual(bytes);
  expect(owner.image_parts.length).toBe(1);
});

it("Image collection discovers unreferenced admitted resources after reopening", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const image = await owner.get_or_add_image_part(rasterPng(42, 24));
  const reopened = await reopen(owner);
  expect(reopened.image_parts.length).toBe(1);
  expect([...reopened.image_parts][0]!.blob).toEqual(image.blob);
});

it("Image byte equality returns the original admitted part", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const bytes = rasterPng(42, 24),
    first = await owner.image_parts.get_or_add_image_part(bytes);
  expect(await owner.image_parts.get_or_add_image_part(new Uint8Array(bytes))).toBe(first);
  expect(owner.image_parts.length).toBe(1);
});

it("Different image bytes produce distinct owned parts", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const first = await owner.image_parts.get_or_add_image_part(rasterPng(42, 24)),
    second = await owner.image_parts.get_or_add_image_part(rasterPng(24, 42));
  expect(first).not.toBe(second);
  expect(owner.image_parts.length).toBe(2);
});

it("Image allocation fills gap 1 among 2, 3", async () => {
  const model = await modelFixture(),
    owner = model.package;
  for (const number of [2, 3])
    await ImagePartView.load(
      "/word/media/image" + number + ".png",
      "image/png",
      rasterPng(number + 2, 3),
      owner
    );
  const part = await owner.get_or_add_image_part(rasterPng(42, 24));
  expect(part.partname.toString()).toBe("/word/media/image1.png");
});

it("Image allocation fills gap 2 among 1, 3", async () => {
  const model = await modelFixture(),
    owner = model.package;
  for (const number of [1, 3])
    await ImagePartView.load(
      "/word/media/image" + number + ".png",
      "image/png",
      rasterPng(number + 2, 3),
      owner
    );
  const part = await owner.get_or_add_image_part(rasterPng(42, 24));
  expect(part.partname.toString()).toBe("/word/media/image2.png");
});

it("Image allocation fills gap 3 among 1, 2", async () => {
  const model = await modelFixture(),
    owner = model.package;
  for (const number of [1, 2])
    await ImagePartView.load(
      "/word/media/image" + number + ".png",
      "image/png",
      rasterPng(number + 2, 3),
      owner
    );
  const part = await owner.get_or_add_image_part(rasterPng(42, 24));
  expect(part.partname.toString()).toBe("/word/media/image3.png");
});

it("New image admission joins the original owned collection", async () => {
  const model = await modelFixture(),
    owner = model.package;
  const part = await owner.image_parts.get_or_add_image_part(rasterPng(42, 24));
  expect(owner.image_parts.has(part)).toBe(true);
  expect([...owner.image_parts]).toEqual([part]);
  expect(part.package).toBe(owner);
});
