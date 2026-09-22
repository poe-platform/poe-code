import type { PdfObject } from "./syntax.js";
import { SyntaxReader } from "./syntax.js";
import type { PdfDocument } from "./revisions.js";

export type PdfBox = [number, number, number, number];
export interface PdfPageOptions { maxNodes?: number }
export interface PdfPage {
  reference: PdfObject;
  raw: PdfObject;
  mediaBox: PdfBox;
  cropBox: PdfBox;
  bleedBox: PdfBox;
  trimBox: PdfBox;
  artBox: PdfBox;
  rotate: number;
  resources: PdfObject | undefined;
  inherited: { mediaBox: PdfObject; cropBox: PdfObject | undefined; rotate: PdfObject | undefined; resources: PdfObject | undefined };
}
export interface PdfInventoryItem {
  reference: PdfObject;
  raw: PdfObject;
  parent: PdfObject | undefined;
}
export interface PdfOutline extends PdfInventoryItem { title: PdfObject; destination: PdfObject | undefined; action: PdfObject | undefined }
export interface PdfLink extends PdfInventoryItem { page: number; rect: PdfBox; destination: PdfObject | undefined; action: PdfObject | undefined }
export interface PdfAttachment extends PdfInventoryItem { name: PdfObject | undefined; embeddedFiles: PdfObject | undefined }
export interface PdfForm extends PdfInventoryItem { name: PdfObject | undefined; fieldType: string | undefined; value: PdfObject | undefined }
export interface PdfPageTree {
  catalog: PdfObject;
  pageTree: PdfObject;
  pages: PdfPage[];
  pageCount: number;
  info: PdfObject | undefined;
  xmp: { reference: PdfObject; raw: Uint8Array; bytes: Uint8Array; dictionary: PdfObject } | undefined;
  outlines: PdfOutline[];
  links: PdfLink[];
  attachments: PdfAttachment[];
  forms: PdfForm[];
}
interface Inheritance { mediaBox?: PdfObject; cropBox?: PdfObject; rotate?: PdfObject; resources?: PdfObject }

/** Original first-party graph interpretation; all reads use the document's owner. */
export function inspectPageTree(document: PdfDocument, reader: SyntaxReader, options: PdfPageOptions): PdfPageTree {
  const maxNodes = options.maxNodes ?? reader.limits.objects;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0) reader.fail("ARGUMENT", "invalid graph limit");
  let nodes = 0;
  const visit = (depth: number) => {
    reader.charge();
    if (++nodes > maxNodes || depth > reader.limits.nesting) reader.fail("LIMIT", "graph limit");
    reader.reserve(256);
  };
  const named = (object: PdfObject | undefined, name: string): boolean => {
    reader.charge();
    if (object?.kind !== "name" || object.bytes!.length !== name.length) return false;
    for (let i = 0; i < name.length; i++) {
      reader.charge();
      if (object.bytes![i] !== name.charCodeAt(i)) return false;
    }
    return true;
  };
  const field = (object: PdfObject, name: string): PdfObject | undefined => {
    for (const entry of object.entries ?? []) {
      reader.charge();
      if (named(entry.key, name)) return entry.value.kind === "null" ? undefined : entry.value;
    }
    return undefined;
  };
  const resolve = (object: PdfObject): PdfObject => object.kind === "reference"
    ? document.resolve(object.objectNumber!, object.generation!) : object;
  const optionalField = (object: PdfObject, name: string): PdfObject | undefined => {
    const value = field(object, name);
    return value && resolve(value).kind !== "null" ? value : undefined;
  };
  const dictionary = (object: PdfObject | undefined, label: string): PdfObject => {
    if (!object) reader.fail("SYNTAX", `missing ${label}`);
    const value = resolve(object);
    if (value.kind !== "dictionary") reader.fail("SYNTAX", `invalid ${label} dictionary`);
    return value;
  };
  const array = (object: PdfObject | undefined, label: string): PdfObject[] => {
    if (!object) reader.fail("SYNTAX", `missing ${label}`);
    const value = resolve(object);
    if (value.kind !== "array") reader.fail("SYNTAX", `invalid ${label} array`);
    return value.items!;
  };
  const numeric = (object: PdfObject | undefined): number => {
    if (!object) reader.fail("SYNTAX", "missing number");
    const value = resolve(object);
    if (value.kind !== "number" || typeof value.value !== "number" || !Number.isFinite(value.value)) reader.fail("SYNTAX", "invalid number");
    return value.value;
  };
  const integer = (object: PdfObject | undefined): number => {
    if (!object) reader.fail("SYNTAX", "missing integer");
    const resolved = resolve(object);
    const value = numeric(resolved);
    reader.charge(resolved.raw?.length ?? 0);
    if (!Number.isSafeInteger(value) || resolved.raw?.includes(46)) reader.fail("SYNTAX", "invalid integer");
    return value;
  };
  const box = (object: PdfObject | undefined): PdfBox => {
    const values = array(object, "box");
    if (values.length !== 4) reader.fail("SYNTAX", "invalid box length");
    reader.reserve(32);
    const result = values.map(numeric) as PdfBox;
    if (result[2] < result[0] || result[3] < result[1]) reader.fail("SYNTAX", "invalid box ordering");
    return result;
  };
  const same = (a: PdfObject | undefined, b: PdfObject): boolean => a?.kind === "reference" && b.kind === "reference" && a.objectNumber === b.objectNumber && a.generation === b.generation;
  const key = (object: PdfObject): string => {
    if (object.kind !== "reference") reader.fail("SYNTAX", "graph node must be indirect");
    return `${object.objectNumber}:${object.generation}`;
  };
  const claim = (object: PdfObject, seen: Set<string>, depth: number) => {
    visit(depth);
    const id = key(object);
    if (seen.has(id)) reader.fail("SYNTAX", "graph cycle or duplicate node");
    seen.add(id);
  };
  reader.check();
  const trailer = document.revisions[0]?.trailer;
  if (!trailer) reader.fail("SYNTAX", "missing trailer");
  const catalog = dictionary(field(trailer, "Root"), "catalog");
  if (!named(field(catalog, "Type"), "Catalog")) reader.fail("SYNTAX", "invalid catalog Type");
  const root = field(catalog, "Pages");
  const pageTree = dictionary(root, "page tree");
  if (!named(field(pageTree, "Type"), "Pages")) reader.fail("SYNTAX", "invalid page tree Type");
  const result: PdfPageTree = { catalog, pageTree, pages: [], pageCount: 0, info: undefined, xmp: undefined, outlines: [], links: [], attachments: [], forms: [] };
  const attachmentSeen = new Set<string>();
  const attachment = (reference: PdfObject, name: PdfObject | undefined, parent: PdfObject | undefined, depth: number) => {
    visit(depth);
    // A file specification can occur in both the name tree and /AF.
    if (reference.kind === "reference") {
      const id = key(reference);
      if (attachmentSeen.has(id)) return;
      attachmentSeen.add(id);
    }
    const raw = dictionary(reference, "file specification");
    const ef = optionalField(raw, "EF");
    result.attachments.push({ reference, raw, parent, name, embeddedFiles: ef ? dictionary(ef, "embedded files") : undefined });
  };
  const associated = (raw: PdfObject, parent: PdfObject | undefined, depth: number) => {
    const af = optionalField(raw, "AF");
    if (af) for (const ref of array(af, "associated files")) attachment(ref, undefined, parent, depth);
  };
  const pageSeen = new Set<string>();
  const walkPages = (reference: PdfObject, parent: PdfObject | undefined, inherited: Inheritance, depth: number): number => {
    claim(reference, pageSeen, depth);
    const raw = dictionary(reference, "page node");
    const actualParent = optionalField(raw, "Parent");
    if (parent ? !same(actualParent, parent) : actualParent !== undefined) reader.fail("SYNTAX", "invalid page parent");
    const next = { ...inherited };
    for (const [name, property] of [["MediaBox", "mediaBox"], ["CropBox", "cropBox"], ["Rotate", "rotate"], ["Resources", "resources"]] as const) {
      const value = optionalField(raw, name);
      if (value) next[property] = value;
    }
    associated(raw, reference, depth + 1);
    if (named(field(raw, "Type"), "Pages")) {
      let count = 0;
      for (const child of array(optionalField(raw, "Kids"), "page kids")) count += walkPages(child, reference, next, depth + 1);
      const declared = integer(optionalField(raw, "Count"));
      if (!Number.isSafeInteger(declared) || declared < 0 || declared !== count) reader.fail("SYNTAX", "invalid page count");
      return count;
    }
    if (!named(field(raw, "Type"), "Page")) reader.fail("SYNTAX", "invalid page Type");
    if (optionalField(raw, "Kids")) reader.fail("SYNTAX", "page leaf has Kids");
    const mediaBox = box(next.mediaBox);
    const requested = next.cropBox ? box(next.cropBox) : mediaBox;
    const cropBox: PdfBox = [Math.max(mediaBox[0], requested[0]), Math.max(mediaBox[1], requested[1]), Math.min(mediaBox[2], requested[2]), Math.min(mediaBox[3], requested[3])];
    reader.reserve(32);
    if (cropBox[2] < cropBox[0] || cropBox[3] < cropBox[1]) reader.fail("SYNTAX", "crop box outside media box");
    const rotation = next.rotate ? integer(next.rotate) : 0;
    if (!Number.isSafeInteger(rotation) || rotation % 90 !== 0) reader.fail("SYNTAX", "invalid page rotation");
    const localBox = (name: string): PdfBox => {
      const value = optionalField(raw, name);
      if (value) return box(value);
      reader.reserve(32);
      return [...cropBox];
    };
    result.pages.push({ reference, raw, mediaBox, cropBox, bleedBox: localBox("BleedBox"), trimBox: localBox("TrimBox"), artBox: localBox("ArtBox"), rotate: ((rotation % 360) + 360) % 360, resources: next.resources ? dictionary(next.resources, "resources") : undefined, inherited: { mediaBox: next.mediaBox!, cropBox: next.cropBox, rotate: next.rotate, resources: next.resources } });
    const annots = optionalField(raw, "Annots");
    if (annots) for (const ref of array(annots, "annotations")) {
      visit(depth + 1);
      const annot = dictionary(ref, "annotation");
      associated(annot, ref, depth + 2);
      if (named(field(annot, "Subtype"), "Link")) result.links.push({ reference: ref, raw: annot, parent: reference, page: result.pages.length, rect: box(field(annot, "Rect")), destination: field(annot, "Dest"), action: field(annot, "A") });
      if (named(field(annot, "Subtype"), "FileAttachment")) {
        const fs = field(annot, "FS");
        if (!fs) reader.fail("SYNTAX", "missing attachment file specification");
        attachment(fs, undefined, ref, depth + 2);
      }
    }
    return 1;
  };
  if (!root) reader.fail("SYNTAX", "missing Pages");
  result.pageCount = walkPages(root, undefined, {}, 0);
  const info = optionalField(trailer, "Info");
  if (info) result.info = dictionary(info, "Info");
  const metadata = optionalField(catalog, "Metadata");
  if (metadata) {
    visit(0); key(metadata);
    const decoded = document.decodeStream(metadata.objectNumber!, metadata.generation!);
    const dict = dictionary(metadata, "metadata");
    if (!named(field(dict, "Type"), "Metadata") || !named(field(dict, "Subtype"), "XML")) reader.fail("SYNTAX", "invalid XMP metadata type");
    result.xmp = { reference: metadata, raw: decoded.raw, bytes: decoded.bytes, dictionary: dict };
  }
  const outlines = optionalField(catalog, "Outlines");
  if (outlines) {
    const seen = new Set<string>();
    const walk = (parent: PdfObject, depth: number): number => {
      const rawParent = dictionary(parent, "outline parent");
      let ref = optionalField(rawParent, "First");
      let previous: PdfObject | undefined;
      let descendants = 0;
      while (ref) {
        claim(ref, seen, depth);
        const raw = dictionary(ref, "outline");
        if (!same(optionalField(raw, "Parent"), parent)) reader.fail("SYNTAX", "invalid outline parent");
        const prev = optionalField(raw, "Prev");
        if (previous ? !same(prev, previous) : prev !== undefined) reader.fail("SYNTAX", "invalid outline previous sibling");
        const title = field(raw, "Title");
        if (!title || resolve(title).kind !== "string") reader.fail("SYNTAX", "invalid outline title");
        result.outlines.push({ reference: ref, raw, parent, title: resolve(title), destination: field(raw, "Dest"), action: field(raw, "A") });
        const children = walk(ref, depth + 1);
        const count = optionalField(raw, "Count");
        let n = 0;
        if (count) {
          n = integer(count);
          if (!Number.isSafeInteger(n) || Math.abs(n) !== children) reader.fail("SYNTAX", "invalid outline count");
        }
        if (children && !count) reader.fail("SYNTAX", "missing outline count");
        descendants += 1 + (n >= 0 ? children : 0);
        previous = ref;
        ref = optionalField(raw, "Next");
      }
      const last = optionalField(rawParent, "Last");
      if (previous ? !same(last, previous) : last !== undefined) reader.fail("SYNTAX", "invalid outline Last");
      return descendants;
    };
    claim(outlines, seen, 0);
    const visible = walk(outlines, 1);
    const count = optionalField(dictionary(outlines, "outlines"), "Count");
    if (visible || count) {
      if (integer(count) !== visible) reader.fail("SYNTAX", "invalid outline count");
    }
  }
  const names = optionalField(catalog, "Names");
  if (names) {
    const embedded = optionalField(dictionary(names, "names"), "EmbeddedFiles");
    if (embedded) {
      const seen = new Set<string>();
      const walk = (ref: PdfObject, depth: number) => {
        if (ref.kind === "reference") claim(ref, seen, depth); else visit(depth);
        const raw = dictionary(ref, "name tree");
        const kids = optionalField(raw, "Kids");
        const entries = optionalField(raw, "Names");
        if (kids && entries) reader.fail("SYNTAX", "name tree has both Kids and Names");
        if (kids) for (const child of array(kids, "name tree kids")) walk(child, depth + 1);
        if (entries) {
          const pairs = array(entries, "name pairs");
          if (pairs.length % 2) reader.fail("SYNTAX", "invalid name pairs");
          for (let i = 0; i < pairs.length; i += 2) {
            const name = resolve(pairs[i]!);
            if (name.kind !== "string") reader.fail("SYNTAX", "invalid attachment name");
            attachment(pairs[i + 1]!, name, ref, depth + 1);
          }
        }
      };
      walk(embedded, 0);
    }
  }
  associated(catalog, undefined, 0);
  const acroForm = optionalField(catalog, "AcroForm");
  if (acroForm) {
    const seen = new Set<string>();
    const walk = (ref: PdfObject, parent: PdfObject | undefined, type: string | undefined, value: PdfObject | undefined, depth: number) => {
      claim(ref, seen, depth);
      const raw = dictionary(ref, "form field");
      const actualParent = optionalField(raw, "Parent");
      if (parent ? !same(actualParent, parent) : actualParent !== undefined) reader.fail("SYNTAX", "invalid form parent");
      const ft = optionalField(raw, "FT");
      if (ft) {
        const resolved = resolve(ft);
        if (resolved.kind !== "name") reader.fail("SYNTAX", "invalid field type");
        reader.charge(resolved.bytes!.length); reader.reserve(resolved.bytes!.length * 2);
        type = "";
        for (const byte of resolved.bytes!) {
          reader.charge();
          type += String.fromCharCode(byte);
        }
      }
      value = optionalField(raw, "V") ?? value;
      result.forms.push({ reference: ref, raw, parent, name: field(raw, "T"), fieldType: type, value });
      const kids = optionalField(raw, "Kids");
      if (kids) for (const child of array(kids, "field kids")) walk(child, ref, type, value, depth + 1);
    };
    const form = dictionary(acroForm, "AcroForm");
    for (const ref of array(field(form, "Fields"), "form fields")) walk(ref, undefined, undefined, undefined, 0);
  }
  return result;
}
