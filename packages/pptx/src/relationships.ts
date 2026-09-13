import { SaxesParser } from "saxes";
import type { PackageReader } from "./package-reader.js";
import { OfficeError } from "./errors.js";
import {
  asciiKey,
  packageUri,
  partName,
  relativePartReference,
  resolvePartReference
} from "./package-uri.js";

export interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}
export interface RelationshipSet {
  readonly owner: string;
  readonly relationships: readonly Relationship[];
}
export interface RelationshipEdge extends Relationship {
  readonly owner: string;
  readonly targetPart: string | null;
}
export interface RelationshipLimits {
  readonly maxBytes: number;
  readonly maxParts: number;
  readonly maxRelationships: number;
}
export interface RelationshipGraph {
  readonly parts: readonly string[];
  readonly dangling: readonly RelationshipEdge[];
  outgoing(owner: string): readonly RelationshipEdge[];
  incoming(target: string): readonly RelationshipEdge[];
  closure(roots: readonly string[]): readonly string[];
}
function invalid(): never {
  throw new OfficeError("invalid-opc", "Invalid package relationships.", "index");
}
function bounded(count: number, limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new OfficeError("invalid-value", "Explicit relationship limits are required.", "usage");
  if (count > limit)
    throw new OfficeError("resource-limit", "Relationship limit exceeded.", "index");
}
function validate(relationship: Relationship): void {
  if (
    !relationship ||
    typeof relationship.id !== "string" ||
    !relationship.id ||
    typeof relationship.type !== "string" ||
    !relationship.type ||
    typeof relationship.target !== "string" ||
    !relationship.target ||
    typeof relationship.external !== "boolean"
  )
    invalid();
}

export function parseRelationships(
  bytes: Uint8Array | null,
  limits: RelationshipLimits
): readonly Relationship[] {
  bounded(bytes?.length ?? 0, limits.maxBytes);
  bounded(0, limits.maxRelationships);
  if (bytes === null) return Object.freeze([]);
  const relationships: Relationship[] = [];
  const ids = new Set<string>();
  let encoding = "utf-8";
  if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 60 && bytes[1] === 0))
    encoding = "utf-16le";
  if ((bytes[0] === 254 && bytes[1] === 255) || (bytes[0] === 0 && bytes[1] === 60))
    encoding = "utf-16be";
  try {
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    parser.on("error", invalid);
    parser.on("doctype", invalid);
    parser.on("cdata", invalid);
    parser.on("xmldecl", (declaration) => {
      if (
        declaration.version !== "1.0" ||
        (declaration.encoding &&
          asciiKey(declaration.encoding) !== (encoding === "utf-8" ? "utf-8" : "utf-16"))
      )
        invalid();
    });
    parser.on("text", (value) => {
      if ([...value].some((character) => !" \t\r\n".includes(character))) invalid();
    });
    parser.on("opentag", (tag) => {
      depth++;
      if (tag.uri !== "http://schemas.openxmlformats.org/package/2006/relationships" || depth > 2)
        invalid();
      const attributes = Object.values(tag.attributes).filter(
        (a) => a.uri !== "http://www.w3.org/2000/xmlns/"
      );
      if (depth === 1) {
        if (tag.local !== "Relationships" || attributes.length) invalid();
        return;
      }
      if (
        tag.local !== "Relationship" ||
        attributes.some((a) => a.uri || !["Id", "Type", "Target", "TargetMode"].includes(a.local))
      )
        invalid();
      const get = (name: string) => attributes.find((a) => a.local === name)?.value;
      const mode = get("TargetMode");
      if (mode !== undefined && mode !== "Internal" && mode !== "External") invalid();
      const relationship = {
        id: get("Id") ?? "",
        type: get("Type") ?? "",
        target: get("Target") ?? "",
        external: mode === "External"
      };
      validate(relationship);
      if (ids.has(relationship.id)) invalid();
      bounded(relationships.length + 1, limits.maxRelationships);
      ids.add(relationship.id);
      relationships.push(Object.freeze(relationship));
    });
    parser.on("closetag", () => {
      depth--;
    });
    parser.write(new TextDecoder(encoding, { fatal: true }).decode(bytes)).close();
  } catch (error) {
    if (error instanceof OfficeError) throw error;
    invalid();
  }
  return Object.freeze(relationships);
}

export function relationshipGraph(
  parts: readonly string[],
  sets: readonly RelationshipSet[],
  limits: RelationshipLimits
): RelationshipGraph {
  bounded(parts.length, limits.maxParts);
  bounded(0, limits.maxRelationships);
  const names = new Map<string, string>();
  const parents = new Set<string>();
  for (const input of parts) {
    const name = partName(input, false);
    const key = asciiKey(name);
    if (
      names.has(key) ||
      parents.has(key) ||
      key === "/[content_types].xml" ||
      relationshipOwner(name) !== null
    )
      invalid();
    let parent = key.slice(0, key.lastIndexOf("/"));
    while (parent) {
      if (names.has(parent)) invalid();
      parents.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
    names.set(key, name);
  }
  const ownerName = (input: string) => {
    if (input === "/") return "/";
    const name = names.get(asciiKey(partName(input, false)));
    if (!name) throw new OfficeError("missing-binding", "Relationship owner is absent.", "index");
    return name;
  };
  const forward = new Map<string, readonly RelationshipEdge[]>();
  const reverse = new Map<string, RelationshipEdge[]>();
  const dangling: RelationshipEdge[] = [];
  let count = 0;
  for (const set of sets) {
    const owner = ownerName(set.owner);
    if (forward.has(owner)) invalid();
    const ids = new Set<string>();
    const edges: RelationshipEdge[] = [];
    for (const relationship of set.relationships) {
      bounded(++count, limits.maxRelationships);
      validate(relationship);
      if (ids.has(relationship.id)) invalid();
      ids.add(relationship.id);
      const resolved = relationship.external
        ? null
        : resolvePartReference(packageUri(owner).baseURI, relationship.target);
      const targetPart = resolved === null ? null : (names.get(asciiKey(resolved)) ?? resolved);
      const edge = Object.freeze({
        id: relationship.id,
        type: relationship.type,
        target: relationship.target,
        external: relationship.external,
        owner,
        targetPart
      });
      edges.push(edge);
      if (targetPart !== null) {
        const key = asciiKey(targetPart);
        const incoming = reverse.get(key) ?? [];
        incoming.push(edge);
        reverse.set(key, incoming);
        if (!names.has(key)) dangling.push(edge);
      }
    }
    forward.set(owner, Object.freeze(edges));
  }
  for (const edges of reverse.values()) Object.freeze(edges);
  const empty = Object.freeze([]);
  return Object.freeze({
    parts: Object.freeze([...names.values()]),
    dangling: Object.freeze(dangling),
    outgoing(owner: string) {
      return forward.get(ownerName(owner)) ?? empty;
    },
    incoming(target: string) {
      return reverse.get(asciiKey(partName(target, false))) ?? empty;
    },
    closure(roots: readonly string[]) {
      bounded(roots.length, limits.maxParts);
      const visited = new Set<string>();
      const result: string[] = [];
      const stack = [...roots].reverse();
      while (stack.length) {
        const name = ownerName(stack.pop()!);
        if (visited.has(name)) continue;
        visited.add(name);
        if (name !== "/") result.push(name);
        const edges = forward.get(name) ?? empty;
        for (let index = edges.length - 1; index >= 0; index--) {
          const edge = edges[index]!;
          if (edge.targetPart !== null) stack.push(edge.targetPart);
        }
      }
      return Object.freeze(result);
    }
  });
}

export function importRelationships(
  destination: RelationshipGraph,
  source: RelationshipGraph,
  roots: readonly string[],
  limits: RelationshipLimits
): {
  readonly graph: RelationshipGraph;
  readonly mapping: readonly (readonly [string, string])[];
} {
  if (roots.includes("/"))
    throw new OfficeError("invalid-value", "Import requires part roots.", "usage");
  const selected = source.closure(roots);
  bounded(destination.parts.length + selected.length, limits.maxParts);
  const occupied = new Set([...destination.parts, ...selected].map(asciiKey));
  const existing = new Set(destination.parts.map(asciiKey));
  const mapping = new Map<string, string>();
  for (const name of selected) {
    let target = name;
    if (existing.has(asciiKey(name))) {
      const uri = packageUri(name);
      const dot = uri.filename.lastIndexOf(".");
      const stem = dot < 0 ? name : name.slice(0, name.length - uri.ext.length - 1);
      const suffix = dot < 0 ? "" : `.${uri.ext}`;
      let index = 1;
      do {
        target = `${stem}-import${index++}${suffix}`;
      } while (occupied.has(asciiKey(target)));
    }
    occupied.add(asciiKey(target));
    mapping.set(name, target);
  }
  const sets: RelationshipSet[] = ["/", ...destination.parts].map((owner) => ({
    owner,
    relationships: destination.outgoing(owner)
  }));
  for (const name of selected) {
    const owner = mapping.get(name)!;
    sets.push({
      owner,
      relationships: source.outgoing(name).map((edge) => ({
        id: edge.id,
        type: edge.type,
        external: edge.external,
        target:
          edge.targetPart === null
            ? edge.target
            : relativePartReference(mapping.get(edge.targetPart)!, packageUri(owner).baseURI)
      }))
    });
  }
  return Object.freeze({
    graph: relationshipGraph([...destination.parts, ...mapping.values()], sets, limits),
    mapping: Object.freeze([...mapping].map((pair) => Object.freeze(pair)))
  });
}

function relationshipOwner(name: string): string | null {
  const key = asciiKey(name);
  if (key === "/_rels/.rels") return "/";
  const slash = name.lastIndexOf("/");
  const directory = name.slice(0, slash);
  if (!asciiKey(directory).endsWith("/_rels") || !key.endsWith(".rels")) return null;
  return partName(`${directory.slice(0, -6)}/${name.slice(slash + 1, -5)}`, false);
}

export function readRelationshipGraph(
  reader: PackageReader,
  limits: RelationshipLimits
): RelationshipGraph {
  const parts: string[] = [];
  const sets: RelationshipSet[] = [];
  let bytesRead = 0;
  let relationships = 0;
  bounded(0, limits.maxBytes);
  bounded(0, limits.maxParts);
  bounded(0, limits.maxRelationships);
  for (const name of reader.names) {
    if (asciiKey(name) === "/[content_types].xml") continue;
    const owner = relationshipOwner(name);
    if (owner === null) {
      bounded(parts.length + 1, limits.maxParts);
      parts.push(name);
    } else {
      bounded(sets.length + 1, limits.maxParts + 1);
      const bytes = reader.get(name);
      bytesRead += bytes.length;
      bounded(bytesRead, limits.maxBytes);
      const parsed = parseRelationships(bytes, limits);
      relationships += parsed.length;
      bounded(relationships, limits.maxRelationships);
      sets.push({ owner, relationships: parsed });
    }
  }
  return relationshipGraph(parts, sets, limits);
}
