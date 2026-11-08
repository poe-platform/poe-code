import { Volume } from "memfs";
import { readPackage, type PackageReader } from "../../src/package-reader.js";
import { storedArchive } from "./archive.js";

export const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const ct = "application/vnd.openxmlformats-officedocument.presentationml.";
export const limits = {
  maxBytes: 100000,
  maxNodes: 2000,
  maxDepth: 40,
  maxParts: 100,
  maxRelationships: 100,
  maxEntries: 100
};
export const context = {
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
export const xml = (root: string, body: string) =>
  `<p:${root} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}">${body}</p:${root}>`;
export const rels = (entries: string[][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}</Relationships>`;
export const tree = (id = "2", extra = "") =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Lantern"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>${extra}</p:spTree></p:cSld>`;
export function fixture(changes: Record<string, string | null> = {}) {
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
export async function readArchive(volume: Volume) {
  const members = Object.keys(volume.toJSON()).map((path) => ({
    name: path.slice(6),
    bytes: new Uint8Array(volume.readFileSync(path) as Uint8Array)
  }));
  return readPackage(storedArchive(members), context);
}

export function read(volume: Volume): PackageReader {
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

