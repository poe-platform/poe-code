import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { validatePresentation } from "./validation.js";
import { readPackage, type PackageReader } from "./package-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ct = "application/vnd.openxmlformats-officedocument.presentationml.";
const limits = {
  maxBytes: 100000,
  maxNodes: 2000,
  maxDepth: 40,
  maxParts: 100,
  maxRelationships: 100,
  maxEntries: 100
};
const context = {
  limits: { maxBytes: 100000, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 100000,
    maxEntryBytes: 10000,
    maxTotalBytes: 100000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 10000,
    chunkSize: 512
  }
};
const xml = (root: string, body: string) =>
  `<p:${root} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}">${body}</p:${root}>`;
const rels = (entries: string[][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}</Relationships>`;
const tree = (id = "2", extra = "") =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Lantern"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>${extra}</p:spTree></p:cSld>`;
function fixture(changes: Record<string, string | null> = {}) {
  const types = {
    "main.xml": "presentation.main",
    "slide.xml": "slide",
    "layout.xml": "slideLayout",
    "master.xml": "slideMaster",
    "notes.xml": "notesSlide",
    "notes-master.xml": "notesMaster"
  };
  const files: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
      types
    )
      .map(([name, type]) => `<Override PartName="/${name}" ContentType="${ct}${type}+xml"/>`)
      .join("")}</Types>`,
    "_rels/.rels": rels([["doc", "officeDocument", "main.xml"]]),
    "main.xml": xml(
      "presentation",
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="notes-master"/></p:notesMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
    ),
    "_rels/main.xml.rels": rels([
      ["master", "slideMaster", "master.xml"],
      ["slide", "slide", "slide.xml"],
      ["notes-master", "notesMaster", "notes-master.xml"]
    ]),
    "slide.xml": xml("sld", tree()),
    "_rels/slide.xml.rels": rels([
      ["layout", "slideLayout", "layout.xml"],
      ["notes", "notesSlide", "notes.xml"]
    ]),
    "layout.xml": xml("sldLayout", tree()),
    "_rels/layout.xml.rels": rels([["master", "slideMaster", "master.xml"]]),
    "master.xml": xml(
      "sldMaster",
      tree() +
        '<p:clrMap/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="layout"/></p:sldLayoutIdLst>'
    ),
    "_rels/master.xml.rels": rels([["layout", "slideLayout", "layout.xml"]]),
    "notes.xml": xml("notes", tree()),
    "_rels/notes.xml.rels": rels([
      ["slide", "slide", "slide.xml"],
      ["master", "notesMaster", "notes-master.xml"]
    ]),
    "notes-master.xml": xml("notesMaster", tree() + "<p:clrMap/>"),
    "opaque.xml": '<custom xmlns="urn:lantern"><payload>untouched</payload></custom>'
  };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete files[name];
    else files[name] = value;
  }
  return Volume.fromJSON(files, "/deck");
}
async function readArchive(volume: Volume) {
  const members = Object.keys(volume.toJSON()).map((path) => ({
    name: path.slice(6),
    bytes: new Uint8Array(volume.readFileSync(path) as Uint8Array)
  }));
  return readPackage(storedArchive(members), context);
}

function read(volume: Volume): PackageReader {
  const names = Object.keys(volume.toJSON()).map((path) => path.slice(5));
  return {
    names,
    has(name) {
      return volume.existsSync(`/deck${name}`);
    },
    get(name) {
      return new Uint8Array(volume.readFileSync(`/deck${name}`) as Uint8Array);
    },
    relsXmlFor(name) {
      const slash = name.lastIndexOf("/");
      const path = `/deck${name.slice(0, slash + 1)}_rels/${name.slice(slash + 1)}.rels`;
      return volume.existsSync(path)
        ? new Uint8Array(volume.readFileSync(path) as Uint8Array)
        : null;
    }
  };
}

describe("presentation semantic validation", () => {
  it("separates implemented rules from schema validation and preserves bytes", async () => {
    const reader = await readArchive(fixture());
    const before = reader.names.map((name) => reader.get(name));
    const result = validatePresentation(reader, limits);
    expect(result).toEqual({
      valid: true,
      schema: "not-checked",
      issues: [],
      rules: [
        "main-part",
        "content-types",
        "relationship-targets",
        "required-structure",
        "slide-ids",
        "shape-ids",
        "master-layouts",
        "note-associations",
        "timing-references",
        "connector-references"
      ]
    });
    expect(reader.names.map((name) => reader.get(name))).toEqual(before);
  });
  it.each([
    ["main-part", { "_rels/.rels": rels([]) }],
    [
      "main-part",
      {
        "_rels/.rels": rels([
          ["one", "officeDocument", "main.xml"],
          ["two", "officeDocument", "main.xml"]
        ])
      }
    ],
    [
      "main-part",
      {
        "_rels/.rels": rels([["one", "officeDocument", "https://invalid.example/deck", "External"]])
      }
    ],
    [
      "main-part",
      {
        "extra.xml": xml("presentation", ""),
        "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="${ct}presentation.main+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`
      }
    ],
    ["content-types", { "untyped.bin": "payload" }],
    ["relationship-targets", { "_rels/slide.xml.rels": rels([["bad", "image", "missing.xml"]]) }],
    ["required-structure", { "slide.xml": xml("sld", "") }],
    ["required-structure", { "slide.xml": xml("sld", tree() + tree()) }],
    ["required-structure", { "slide.xml": xml("notes", tree()) }],
    [
      "slide-ids",
      {
        "main.xml": xml(
          "presentation",
          '<p:sldIdLst><p:sldId id="255" r:id="slide"/></p:sldIdLst><p:notesSz cx="1" cy="1"/>'
        )
      }
    ],
    [
      "slide-ids",
      {
        "main.xml": xml(
          "presentation",
          '<p:sldIdLst><p:sldId id="256" r:id="slide"/><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:notesSz cx="1" cy="1"/>'
        )
      }
    ],
    [
      "slide-ids",
      {
        "main.xml": xml(
          "presentation",
          '<p:sldIdLst><p:sldId id="256" r:id="absent"/></p:sldIdLst><p:notesSz cx="1" cy="1"/>'
        )
      }
    ],
    ["shape-ids", { "slide.xml": xml("sld", tree("1")) }],
    ["shape-ids", { "slide.xml": xml("sld", tree("-1")) }],
    ["master-layouts", { "_rels/layout.xml.rels": rels([]) }],
    ["master-layouts", { "_rels/slide.xml.rels": rels([]) }],
    [
      "master-layouts",
      {
        "master.xml": xml(
          "sldMaster",
          tree() +
            '<p:clrMap/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="absent"/></p:sldLayoutIdLst>'
        )
      }
    ],
    [
      "note-associations",
      { "_rels/notes.xml.rels": rels([["master", "notesMaster", "notes-master.xml"]]) }
    ],
    ["note-associations", { "_rels/notes.xml.rels": rels([["slide", "slide", "slide.xml"]]) }],
    [
      "timing-references",
      {
        "slide.xml": xml(
          "sld",
          tree() +
            '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:stCondLst><p:cond><p:tn val="9"/></p:cond></p:stCondLst></p:cTn></p:par></p:tnLst></p:timing>'
        )
      }
    ],
    [
      "timing-references",
      {
        "slide.xml": xml(
          "sld",
          tree() +
            '<p:timing><p:tnLst><p:par><p:cTn id="1"/><p:cTn id="1"/></p:par></p:tnLst></p:timing>'
        )
      }
    ],
    [
      "timing-references",
      {
        "slide.xml": xml(
          "sld",
          tree() + '<p:timing><p:bldLst><p:bldP spid="99" grpId="0"/></p:bldLst></p:timing>'
        )
      }
    ],
    [
      "connector-references",
      {
        "slide.xml": xml(
          "sld",
          tree(
            "2",
            '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="Link"/><p:cNvCxnSpPr><a:stCxn id="99" idx="0"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>'
          )
        )
      }
    ]
  ] as const)("reports independently malformed %s structures", async (rule, changes) => {
    const result = validatePresentation(await read(fixture(changes)), limits);
    expect(result.valid).toBe(false);
    expect(result.schema).toBe("not-checked");
    expect(result.issues).toContainEqual(expect.objectContaining({ rule }));
  });
  it("rejects an unlisted layout despite a relationship to it", async () => {
    const result = validatePresentation(
      await read(fixture({ "master.xml": xml("sldMaster", tree() + "<p:clrMap/>") })),
      limits
    );
    expect(result.issues).toContainEqual({ rule: "master-layouts", part: "/master.xml" });
  });
  it.each(["256", "2147483647", "+000256"])("accepts slide identifier boundary %s", async (id) => {
    const result = validatePresentation(
      await read(
        fixture({
          "main.xml": xml(
            "presentation",
            `<p:sldIdLst><p:sldId id="${id}" r:id="slide"/></p:sldIdLst><p:notesSz cx="1" cy="1"/>`
          )
        })
      ),
      limits
    );
    expect(result.issues).toEqual([]);
  });
  it.each(["2147483648", "1e3", "", "-256"])("rejects invalid slide identifier %s", async (id) => {
    const result = validatePresentation(
      await read(
        fixture({
          "main.xml": xml(
            "presentation",
            `<p:sldIdLst><p:sldId id="${id}" r:id="slide"/></p:sldIdLst><p:notesSz cx="1" cy="1"/>`
          )
        })
      ),
      limits
    );
    expect(result.issues).toContainEqual({ rule: "slide-ids", part: "/main.xml" });
  });
  it("accepts a Strict empty presentation without converting its bytes", async () => {
    const volume = Volume.fromJSON(
      {
        "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/main.xml" ContentType="${ct}presentation.main+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
        "_rels/.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="deck" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument" Target="main.xml"/></Relationships>',
        "main.xml":
          '<s:presentation xmlns:s="http://purl.oclc.org/ooxml/presentationml/main"><s:notesSz cx="1" cy="1"/></s:presentation>'
      },
      "/deck"
    );
    const reader = await read(volume);
    const before = reader.get("/main.xml");
    expect(validatePresentation(reader, limits).issues).toEqual([]);
    expect(reader.get("/main.xml")).toEqual(before);
  });
  it("reports missing layout targets without an incidental lookup failure", async () => {
    const result = validatePresentation(
      await read(fixture({ "layout.xml": null, "_rels/layout.xml.rels": null })),
      limits
    );
    expect(result.issues).toContainEqual({ rule: "relationship-targets", part: "/slide.xml" });
    expect(result.issues).toContainEqual({ rule: "master-layouts", part: "/slide.xml" });
  });
  it("reports a layout with a missing master target", async () => {
    const result = validatePresentation(
      await read(fixture({ "master.xml": null, "_rels/master.xml.rels": null })),
      limits
    );
    expect(result.issues).toContainEqual({ rule: "master-layouts", part: "/layout.xml" });
  });
  it("accepts an unselected invalid fallback without counting its IDs", async () => {
    const alternate =
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p"><p:sp><p:nvSpPr><p:cNvPr id="3" name="Selected"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="2" name="Fallback"/></p:nvSpPr></p:sp></mc:Fallback></mc:AlternateContent>';
    expect(
      validatePresentation(
        await read(fixture({ "slide.xml": xml("sld", tree("2", alternate)) })),
        limits
      ).issues
    ).toEqual([]);
  });
  it("does not count shape-like content inside unknown extensions", async () => {
    const extension =
      '<p:extLst><p:ext uri="urn:lantern"><opaque xmlns="urn:lantern" xmlns:u="urn:lantern" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u"><p:cNvPr id="2" name="Stored"/></opaque></p:ext></p:extLst>';
    expect(
      validatePresentation(
        await read(fixture({ "slide.xml": xml("sld", tree("2", extension)) })),
        limits
      ).issues
    ).toEqual([]);
  });
  it("refuses required unknown namespace attributes before claiming semantic validity", () => {
    const reader = read(
      fixture({
        "slide.xml":
          '<p:sld xmlns:p="' +
          p +
          '" xmlns:q="urn:lantern-required" q:mode="retain">' +
          tree() +
          "</p:sld>"
      })
    );
    expect(() => validatePresentation(reader, limits)).toThrowError(
      expect.objectContaining({ code: "unsupported-profile" })
    );
  });
  it("rejects malformed XML and enforces cumulative XML limits", async () => {
    const malformed = await read(fixture({ "slide.xml": "<broken>" }));
    expect(() => validatePresentation(malformed, limits)).toThrowError(
      expect.objectContaining({ code: "invalid-xml" })
    );
    const reader = await read(fixture());
    expect(() => validatePresentation(reader, { ...limits, maxNodes: 50 })).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
  });
  it("accepts local references and repeated shape IDs in different parts", async () => {
    const result = validatePresentation(
      await read(
        fixture({
          "slide.xml": xml(
            "sld",
            tree(
              "2",
              '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="Link"/><p:cNvCxnSpPr><a:stCxn id="2" idx="0"/><a:endCxn id="1" idx="0"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>'
            ) +
              '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:stCondLst><p:cond><p:tn val="1"/></p:cond></p:stCondLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="2" grpId="0"/></p:bldLst></p:timing>'
          )
        })
      ),
      limits
    );
    expect(result.issues).toEqual([]);
  });
});
