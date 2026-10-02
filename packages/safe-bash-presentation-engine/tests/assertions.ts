import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Volume } from "memfs";
import { parseXml, type XmlElement } from "../../safe-fs/src/xml.js";

type MemoryDeck = { volume: Volume; root: string };
type Name = { namespace: string; localName: string };
type Relationship = { id: string; type: string; target: string; external: boolean };
type PropertySite = { part: string; path: readonly Name[]; attribute: Name };

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";

function partPath(deck: MemoryDeck, part: string): string {
  assert(
    part.length > 0 &&
      !part.startsWith("/") &&
      !part.includes("\\") &&
      part.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    `invalid part path: ${part}`
  );
  return posix.join(deck.root, part);
}

function xml(deck: MemoryDeck, part: string): XmlElement {
  return parseXml(deck.volume.readFileSync(partPath(deck, part), "utf8") as string);
}

function attribute(node: XmlElement, localName: string, namespace = ""): string | null {
  return (
    node.attributes.find((item) => item.localName === localName && item.namespace === namespace)
      ?.value ?? null
  );
}

function descendants(node: XmlElement, namespace: string, localName: string): XmlElement[] {
  return [
    node,
    ...node.children.flatMap((child) => descendants(child, namespace, localName))
  ].filter((item) => item.namespace === namespace && item.localName === localName);
}

function relationships(deck: MemoryDeck, owner: string): Relationship[] {
  if (owner) partPath(deck, owner);
  const part =
    owner === ""
      ? "_rels/.rels"
      : posix.join(posix.dirname(owner), "_rels", `${posix.basename(owner)}.rels`);
  const root = xml(deck, part);
  assert(
    root.namespace === relNs && root.localName === "Relationships",
    `relationship root: ${part}`
  );
  const ids = new Set<string>();
  return root.children.map((node) => {
    assert(
      node.namespace === relNs && node.localName === "Relationship",
      `relationship element: ${part}`
    );
    const id = attribute(node, "Id");
    const type = attribute(node, "Type");
    const target = attribute(node, "Target");
    const mode = attribute(node, "TargetMode");
    assert(id && type && target, `missing relationship attribute: ${part}`);
    assert(!ids.has(id), `duplicate relationship ID: ${owner}#${id}`);
    ids.add(id);
    assert(
      mode === null || mode === "Internal" || mode === "External",
      `relationship mode: ${part}`
    );
    const edge = { id, type, target, external: mode === "External" };
    if (!edge.external) {
      const resolved = targetPart(owner, edge);
      assert(
        deck.volume.existsSync(partPath(deck, resolved)) &&
          deck.volume.statSync(partPath(deck, resolved)).isFile(),
        `missing target: ${resolved}`
      );
    }
    return edge;
  });
}

function targetPart(owner: string, edge: Relationship): string {
  assert(!edge.external, `external target: ${owner}#${edge.id}`);
  return posix.normalize(
    edge.target.startsWith("/")
      ? edge.target.slice(1)
      : posix.join(posix.dirname(owner), edge.target)
  );
}

export function assertPartHashes(
  deck: MemoryDeck,
  expected: Readonly<Record<string, string>>
): void {
  for (const [part, hash] of Object.entries(expected)) {
    const bytes = deck.volume.readFileSync(partPath(deck, part));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, `part hash: ${part}`);
  }
}

export function assertRelationships(
  deck: MemoryDeck,
  owner: string,
  expected: readonly Relationship[]
): void {
  const byId = (edges: readonly Relationship[]) =>
    [...edges].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  assert.deepEqual(byId(relationships(deck, owner)), byId(expected), `relationships: ${owner}`);
}

export function assertSlideOrder(
  deck: MemoryDeck,
  presentationPart: string,
  expected: readonly { id: string; relationshipId: string; part: string }[]
): void {
  const edges = relationships(deck, presentationPart);
  const root = xml(deck, presentationPart);
  assert(root.namespace === p && root.localName === "presentation", "presentation root");
  const lists = root.children.filter(
    (node) => node.namespace === p && node.localName === "sldIdLst"
  );
  assert(lists.length <= 1, "duplicate slide list");
  const ids = new Set<string>();
  const usedEdges = new Set<string>();
  const actual = (lists[0]?.children ?? []).map((node) => {
    assert(node.namespace === p && node.localName === "sldId", "slide list element");
    const id = attribute(node, "id");
    const relationshipId = attribute(node, "id", r);
    assert(id && relationshipId, "missing slide ID");
    assert(!ids.has(id), `duplicate slide ID: ${id}`);
    assert(!usedEdges.has(relationshipId), `duplicate slide relationship: ${relationshipId}`);
    ids.add(id);
    usedEdges.add(relationshipId);
    const edge = edges.find((item) => item.id === relationshipId);
    assert(edge, `missing slide relationship: ${relationshipId}`);
    assert(
      edge.type === `${r}/slide` && !edge.external,
      `invalid slide relationship: ${relationshipId}`
    );
    return { id, relationshipId, part: targetPart(presentationPart, edge) };
  });
  assert.deepEqual(actual, expected, "slide order");
}

export function assertInheritedProperties(
  deck: MemoryDeck,
  sites: readonly PropertySite[],
  expected: { values: readonly (string | null)[]; effective: string | null; source: string | null }
): void {
  assert(sites.length > 0, "empty property sites");
  const values = sites.map((site) => {
    assert(site.path.length > 0, "empty property path");
    let nodes = [xml(deck, site.part)];
    site.path.forEach((name, index) => {
      if (index > 0) nodes = nodes.flatMap((node) => node.children);
      nodes = nodes.filter(
        (node) => node.namespace === name.namespace && node.localName === name.localName
      );
      assert(nodes.length <= 1, `ambiguous property site: ${site.part}`);
    });
    return nodes[0]
      ? attribute(nodes[0], site.attribute.localName, site.attribute.namespace)
      : null;
  });
  const index = values.findIndex((value) => value !== null);
  assert.deepEqual(
    {
      values,
      effective: index === -1 ? null : values[index],
      source: index === -1 ? null : sites[index].part
    },
    expected,
    "inherited properties"
  );
}

export function assertResourceOccurrences(
  deck: MemoryDeck,
  owners: readonly string[],
  expected: Readonly<Record<string, number>>
): void {
  assert(new Set(owners).size === owners.length, "duplicate resource owner");
  const counts = new Map<string, number>();
  for (const owner of owners) {
    const blips = descendants(xml(deck, owner), a, "blip");
    if (blips.length === 0) continue;
    const edges = relationships(deck, owner);
    for (const blip of blips) {
      const id = attribute(blip, "embed", r);
      assert(
        id !== null && attribute(blip, "link", r) === null,
        "only embedded image occurrences are supported"
      );
      const edge = edges.find((item) => item.id === id);
      assert(edge, `missing image relationship: ${owner}#${id}`);
      assert(
        edge.type === `${r}/image` && !edge.external,
        `invalid image relationship: ${owner}#${id}`
      );
      const part = targetPart(owner, edge);
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  assert.deepEqual(Object.fromEntries(counts), expected, "resource occurrences");
}
