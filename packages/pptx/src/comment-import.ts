import { OfficeError } from "./errors.js";
import { attr } from "./masters.js";
import type { PackageReader } from "./package-reader.js";
import type { RelationshipGraph } from "./relationships.js";
import { parseXmlPart, type XmlPart, type XmlLimits } from "./xml.js";

const authorType =
  "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml";
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Import cannot establish legacy comment author identity.",
    "validate-intent"
  );
}
function integer(value: string | undefined) {
  if (
    value === undefined ||
    !value.length ||
    [...value].some((c) => c < "0" || c > "9") ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 4294967295
  )
    unsupported();
  return Number(value);
}
export function prepareCommentImport(options: {
  source: PackageReader;
  destination: PackageReader;
  sourceGraph: RelationshipGraph;
  destinationGraph: RelationshipGraph;
  sourceMain: string;
  destinationMain: string;
  parts: readonly string[];
  dialect: { p: string; r: string };
  xmlLimits: XmlLimits;
  sourceType: (part: string) => string;
  destinationType: (part: string) => string;
}) {
  if (!options.parts.length) return undefined;
  const { source, destination, dialect } = options;
  const parse = (bytes: Uint8Array) => parseXmlPart(bytes, options.xmlLimits);
  const authorPart = (graph: RelationshipGraph, main: string) => {
    const edges = graph
      .outgoing(main)
      .filter((edge) => edge.type === `${dialect.r}/commentAuthors`);
    if (edges.length > 1 || edges.some((edge) => edge.external || !edge.targetPart)) unsupported();
    return edges[0]?.targetPart;
  };
  const sourcePart = authorPart(options.sourceGraph, options.sourceMain);
  const destinationPart = authorPart(options.destinationGraph, options.destinationMain);
  if (
    !sourcePart ||
    options.sourceType(sourcePart) !== authorType ||
    options.sourceGraph.outgoing(sourcePart).length
  )
    unsupported();
  if (destinationPart && options.destinationType(destinationPart) !== authorType) unsupported();
  const sourceAuthors = parse(source.get(sourcePart));
  let authors = destinationPart
    ? parse(destination.get(destinationPart))
    : parse(new TextEncoder().encode(`<p:cmAuthorLst xmlns:p="${dialect.p}"/>`));
  const collect = (document: XmlPart) => {
    if (
      document.root.name.namespace !== dialect.p ||
      document.root.name.localName !== "cmAuthorLst"
    )
      unsupported();
    const result = new Map<number, number>();
    document.root.children.forEach((node, index) => {
      if (node.name.namespace !== dialect.p || node.name.localName !== "cmAuthor") unsupported();
      const id = integer(attr(node, "id"));
      if (result.has(id)) unsupported();
      result.set(id, index);
    });
    return result;
  };
  const sourceIds = collect(sourceAuthors);
  const destinationIds = collect(authors);
  const usedSourceIds = new Set<number>();
  const documents = new Map<string, XmlPart>();
  const highestIndices = new Map<number, number>();
  for (const part of options.parts) {
    if (options.sourceGraph.outgoing(part).length) unsupported();
    const xml = parse(source.get(part));
    if (xml.root.name.namespace !== dialect.p || xml.root.name.localName !== "cmLst") unsupported();
    const identities = new Set<string>();
    for (const node of xml.root.children) {
      if (node.name.namespace !== dialect.p || node.name.localName !== "cm") unsupported();
      const id = integer(attr(node, "authorId"));
      const index = integer(attr(node, "idx"));
      const identity = `${id}:${index}`;
      if (!sourceIds.has(id) || identities.has(identity)) unsupported();
      identities.add(identity);
      usedSourceIds.add(id);
      highestIndices.set(id, Math.max(highestIndices.get(id) ?? 0, index));
    }
    documents.set(part, xml);
  }
  const remapping = new Map<number, string>();
  let next = 0;
  for (const id of usedSourceIds) {
    while (destinationIds.has(next)) next++;
    if (next > 4294967295) unsupported();
    const mapped = String(next++);
    remapping.set(id, mapped);
    const node = sourceAuthors.root.children[sourceIds.get(id)!]!;
    let author = parse(new TextEncoder().encode(sourceAuthors.markup(node, true)));
    if (author.root.children.length) unsupported();
    author = author.merge(author.root, {
      attributes: [
        { namespace: "", localName: "id", value: mapped },
        {
          namespace: "",
          localName: "lastIdx",
          value: String(Math.max(integer(attr(node, "lastIdx")), highestIndices.get(id)!))
        }
      ]
    });
    authors = authors.spliceChildren(authors.root, authors.root.children.length, 0, [
      author.markup(author.root, true)
    ]);
  }
  const comments = new Map<string, Uint8Array>();
  for (const [part, original] of documents) {
    let xml = original;
    for (let index = 0; index < xml.root.children.length; index++) {
      const node = xml.root.children[index]!;
      xml = xml.merge(node, {
        attributes: [
          {
            namespace: "",
            localName: "authorId",
            value: remapping.get(integer(attr(node, "authorId")))!
          }
        ]
      });
    }
    comments.set(part, xml.bytes());
  }
  return { destinationPart, authors: authors.bytes(), comments };
}
