import type { XmlElement } from "./package-xml.js";
import {
  InputTypeError,
  InvalidValueError,
  ResourceLimitError,
  type ArchiveLimits,
  type ArchiveMember,
  type DocumentArchive
} from "./archive.js";
import { xml, InvalidPackageError } from "./package-xml.js";
import {
  asciiKey,
  invalidPackage,
  normalizePartName,
  relativePartTarget,
  resolvePartTarget
} from "./part-uri.js";

const contentTypesNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const relationshipContentType = "application/vnd.openxmlformats-package.relationships+xml";

export interface PackagePart extends ArchiveMember {
  readonly partname: string;
  readonly content_type: string;
}
export interface ContentTypeDefault {
  readonly extension: string;
  readonly content_type: string;
}
export interface ContentTypeOverride {
  readonly partname: string;
  readonly content_type: string;
}
export interface PackageRelationship {
  readonly rId: string;
  readonly reltype: string;
  readonly target_ref: string;
  readonly is_external: boolean;
  readonly fragment: string | null;
  readonly target_part: PackagePart;
}

function metadataXml(part: string, bytes: Uint8Array, visit: (tag: XmlElement, depth: number) => void): void {
  let location = "/";
  let index = 0;
  try {
    xml(bytes, (tag, depth) => {
      location = `/${tag.localName}[${++index}]`;
      visit(tag, depth);
    }, true);
  } catch (error) {
    if (error instanceof InvalidPackageError)
      throw new InvalidPackageError(error.message, part, location, error.diagnosticCode);
    throw error;
  }
}

function attributes(tag: XmlElement, allowed: readonly string[]): void {
  for (const attribute of tag.attributes) {
    if (attribute.namespace === "http://www.w3.org/2000/xmlns/") continue;
    if (attribute.namespace || !allowed.includes(attribute.localName)) invalidPackage();
  }
}
function required(tag: XmlElement, name: string, allowEmpty = false): string {
  const value = tag.attributes.find(attribute => attribute.name === name);
  if (!value || value.namespace || (!allowEmpty && !value.value)) return invalidPackage();
  return value.value;
}
function relationshipOwner(name: string): string | null {
  if (asciiKey(name) === "/_rels/.rels") return "/";
  const segments = name.split("/");
  const filename = segments.pop()!;
  if (asciiKey(segments.at(-1) ?? "") !== "_rels" || !asciiKey(filename).endsWith(".rels"))
    return null;
  segments.pop();
  return normalizePartName([...segments, filename.slice(0, -5)].join("/"));
}
function validId(value: string): boolean {
  let index = 0;
  for (const char of value) {
    const c = char.codePointAt(0)!;
    const start =
      char === "_" ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 0xc0 && c <= 0xd6) ||
      (c >= 0xd8 && c <= 0xf6) ||
      (c >= 0xf8 && c <= 0x2ff) ||
      (c >= 0x370 && c <= 0x37d) ||
      (c >= 0x37f && c <= 0x1fff) ||
      (c >= 0x200c && c <= 0x200d) ||
      (c >= 0x2070 && c <= 0x218f) ||
      (c >= 0x2c00 && c <= 0x2fef) ||
      (c >= 0x3001 && c <= 0xd7ff) ||
      (c >= 0xf900 && c <= 0xfdcf) ||
      (c >= 0xfdf0 && c <= 0xfffd) ||
      (c >= 0x10000 && c <= 0xeffff);
    if (
      !start &&
      !(
        index > 0 &&
        (char === "-" ||
          char === "." ||
          (c >= 48 && c <= 57) ||
          c === 0xb7 ||
          (c >= 0x300 && c <= 0x36f) ||
          (c >= 0x203f && c <= 0x2040))
      )
    )
      return false;
    index++;
  }
  return index > 0;
}

export class DocumentPackage {
  readonly parts: readonly PackagePart[];
  readonly defaults: readonly ContentTypeDefault[];
  readonly overrides: readonly ContentTypeOverride[];
  private readonly byName = new Map<string, PackagePart>();
  private readonly edges = new Map<string, readonly PackageRelationship[]>();
  private readonly reservedIds = new Map<string, Set<string>>();
  private readonly reservedNames = new Set<string>();

  private readonly limits: ArchiveLimits;
  private remainingMembers: number;

  constructor(archive: DocumentArchive, limits: ArchiveLimits) {
    this.limits = { ...limits };
    this.remainingMembers = limits.maxMembers - archive.members.length;
    const members = new Map<string, ArchiveMember>();
    const names = new Map<string, string>();
    for (const member of archive.members) {
      if (member.directory) continue;
      const partname =
        asciiKey(member.name) === "[content_types].xml"
          ? "/[Content_Types].xml"
          : normalizePartName("/" + member.name);
      const key = asciiKey(partname);
      const collision = asciiKey(partname.normalize("NFC"));
      if (members.has(key) || this.reservedNames.has(collision)) invalidPackage();
      members.set(key, member);
      names.set(key, partname);
      this.reservedNames.add(collision);
    }
    for (const key of this.reservedNames) {
      const segments = key.split("/");
      segments.pop();
      while (segments.length > 1) {
        if (this.reservedNames.has(segments.join("/"))) invalidPackage();
        segments.pop();
      }
    }
    const types = members.get("/[content_types].xml");
    if (!types || !members.has("/_rels/.rels")) invalidPackage();
    const defaults = new Map<string, string>();
    const overrides = new Map<string, string>();
    const defaultValues: ContentTypeDefault[] = [];
    const overrideValues: ContentTypeOverride[] = [];
    metadataXml(
      "/[Content_Types].xml", types.bytes,
      (tag, depth) => {
        if (tag.namespace !== contentTypesNamespace) invalidPackage();
        if (depth === 1) {
          if (tag.localName !== "Types") invalidPackage();
          attributes(tag, []);
          return;
        }
        if (depth !== 2 || (tag.localName !== "Default" && tag.localName !== "Override")) invalidPackage();
        const override = tag.localName === "Override";
        attributes(tag, [override ? "PartName" : "Extension", "ContentType"]);
        const content_type = required(tag, "ContentType");
        const name = required(tag, override ? "PartName" : "Extension");
        if (override) {
          const partname = normalizePartName(name);
          const key = asciiKey(partname);
          if (!members.has(key) || overrides.has(key) || key === "/[content_types].xml")
            invalidPackage();
          overrides.set(key, content_type);
          overrideValues.push(Object.freeze({ partname, content_type }));
        } else {
          for (let index = 0; index < name.length; index++) {
            const char = name[index]!;
            if (char === "%") {
              const digits = name.slice(index + 1, index + 3);
              if (
                digits.length !== 2 ||
                [...digits].some((digit) => !"0123456789abcdefABCDEF".includes(digit))
              )
                invalidPackage();
              index += 2;
            } else if (
              !(
                (char >= "a" && char <= "z") ||
                (char >= "A" && char <= "Z") ||
                (char >= "0" && char <= "9") ||
                "!$&'()*+,:=@-_~".includes(char)
              )
            )
              invalidPackage();
          }
          const key = asciiKey(name);
          if (defaults.has(key)) invalidPackage();
          defaults.set(key, content_type);
          defaultValues.push(Object.freeze({ extension: name, content_type }));
        }
      }
    );
    this.defaults = Object.freeze(defaultValues);
    this.overrides = Object.freeze(overrideValues);
    const parts: PackagePart[] = [];
    for (const [key, member] of members) {
      if (key === "/[content_types].xml") continue;
      const filename = key.slice(key.lastIndexOf("/") + 1);
      const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
      const content_type = overrides.get(key) ?? defaults.get(extension);
      if (!content_type) invalidPackage();
      const part = Object.freeze({ ...member, partname: names.get(key)!, content_type });
      parts.push(part);
      this.byName.set(key, part);
    }
    this.parts = Object.freeze(parts);
    for (const part of parts) {
      const owner = relationshipOwner(part.partname);
      if (owner === null) {
        if (asciiKey(part.content_type) === relationshipContentType) invalidPackage();
        continue;
      }
      if (asciiKey(part.content_type) !== relationshipContentType) invalidPackage();
      if (owner !== "/" && (!this.byName.has(asciiKey(owner)) || relationshipOwner(owner) !== null))
        invalidPackage();
      const ids = new Set<string>();
      const relationships: PackageRelationship[] = [];
      metadataXml(
        part.partname, part.bytes,
        (tag, depth) => {
          if (tag.namespace !== relationshipsNamespace) invalidPackage();
          if (depth === 1) {
            if (tag.localName !== "Relationships") invalidPackage();
            attributes(tag, []);
            return;
          }
          if (depth !== 2 || tag.localName !== "Relationship") invalidPackage();
          attributes(tag, ["Id", "Type", "Target", "TargetMode"]);
          const rId = required(tag, "Id");
          const reltype = required(tag, "Type");
          const target_ref = required(tag, "Target", true);
          if (!validId(rId) || ids.has(rId)) invalidPackage();
          ids.add(rId);
          const mode = tag.attributes.find(attribute => attribute.name === "TargetMode")?.value ?? "Internal";
          if (mode !== "External" && mode !== "Internal") invalidPackage();
          const is_external = mode === "External";
          const resolved = is_external ? null : resolvePartTarget(owner, target_ref);
          const target = resolved ? this.byName.get(asciiKey(resolved.partname)) : undefined;
          if (!is_external && (!target || relationshipOwner(target.partname) !== null))
            invalidPackage();
          relationships.push(
            Object.freeze({
              rId,
              reltype,
              target_ref,
              is_external,
              fragment: resolved?.fragment ?? null,
              get target_part(): PackagePart {
                if (!target)
                  throw new InvalidValueError("External relationships have no package target.");
                return target;
              }
            })
          );
        }
      );
      this.edges.set(asciiKey(owner), Object.freeze(relationships));
      this.reservedIds.set(asciiKey(owner), ids);
    }
  }

  getPart(partname: string): PackagePart {
    const part = this.byName.get(asciiKey(normalizePartName(partname)));
    if (!part) throw new InvalidValueError("Package part was not found.");
    return part;
  }

  relationships(owner: string): readonly PackageRelationship[] {
    const key = owner === "/" ? "/" : asciiKey(this.getPart(owner).partname);
    if (owner !== "/" && relationshipOwner(owner) !== null)
      throw new InvalidValueError("Relationships cannot own relationships.");
    return this.edges.get(key) ?? [];
  }

  *iterParts(): IterableIterator<PackagePart> {
    const visited = new Set<PackagePart>();
    const stack = [...this.relationships("/")].reverse();
    while (stack.length) {
      const edge = stack.pop()!;
      if (edge.is_external || visited.has(edge.target_part)) continue;
      const part = edge.target_part;
      visited.add(part);
      yield part;
      const children = this.relationships(part.partname);
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]!);
    }
  }

  allocateRelationshipId(owner: string): string {
    const edges = this.relationships(owner);
    const key = owner === "/" ? "/" : asciiKey(this.getPart(owner).partname);
    const ids = this.reservedIds.get(key) ?? new Set(edges.map((edge) => edge.rId));
    let index = 1;
    while (ids.has(`rId${index}`)) index++;
    const id = `rId${index}`;
    ids.add(id);
    this.reservedIds.set(key, ids);
    return id;
  }

  allocatePartName(prefix: string, suffix: string): string {
    if (typeof prefix !== "string" || typeof suffix !== "string")
      throw new InputTypeError("Expected a part name prefix and suffix.");
    if (this.remainingMembers <= 0 || prefix.length + suffix.length > this.limits.maxPathBytes)
      throw new ResourceLimitError("Package part reservation limit exceeded.");
    for (let index = 1; index <= this.reservedNames.size + 1; index++) {
      const name = normalizePartName(`${prefix}${index}${suffix}`);
      if (
        relativePartTarget("/", name).length > this.limits.maxPathBytes ||
        name.split("/").length - 1 > this.limits.maxDepth
      )
        throw new ResourceLimitError("Package part path limit exceeded.");
      if (relationshipOwner(name) !== null)
        throw new InvalidValueError("Cannot allocate a relationship part name.");
      const key = asciiKey(name.normalize("NFC"));
      if (this.reservedNames.has(key)) continue;
      for (const existing of this.reservedNames) {
        if (existing.startsWith(key + "/") || key.startsWith(existing + "/"))
          throw new InvalidValueError("Allocated part name conflicts with a package part.");
      }
      this.reservedNames.add(key);
      this.remainingMembers--;
      return name;
    }
    throw new InvalidValueError("No package part name is available.");
  }
}
