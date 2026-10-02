import type { PartInventory } from "./inventory.js";
import type { RelationshipGraph } from "./relationships.js";

export const diagramContentTypes = {
  data: "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
  layout: "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml",
  style: "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml",
  colors: "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml",
  drawing: "application/vnd.ms-office.drawingml.diagramDrawing+xml"
} as const;
type DiagramKind = keyof typeof diagramContentTypes;
export const diagramRelationshipKinds: Readonly<Record<string, DiagramKind>> = Object.freeze({
  ...Object.fromEntries(
    [
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "http://purl.oclc.org/ooxml/officeDocument/relationships"
    ].flatMap((namespace) =>
      Object.entries({
        diagramData: "data",
        diagramLayout: "layout",
        diagramQuickStyle: "style",
        diagramColors: "colors"
      } as const).map(([name, kind]) => [`${namespace}/${name}`, kind])
    )
  ),
  "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing": "drawing"
});
export interface DiagramInventory {
  readonly part: string;
  readonly kind: DiagramKind;
  readonly owners: readonly string[];
  readonly dependencies: readonly string[];
  readonly missing: readonly string[];
  readonly semanticEditing: false;
}

export function inspectDiagrams(
  parts: readonly PartInventory[],
  graph: RelationshipGraph
): readonly DiagramInventory[] {
  const present = new Set(graph.parts);
  return Object.freeze(
    parts.flatMap((part) => {
      const kind =
        (Object.keys(diagramContentTypes) as DiagramKind[]).find(
          (key) => diagramContentTypes[key] === part.contentType
        ) ??
        graph
          .incoming(part.part)
          .map((edge) => diagramRelationshipKinds[edge.type])
          .find((value) => value !== undefined);
      if (!kind) return [];
      const visited = new Set([part.part]);
      const missing = new Set<string>();
      const pending = [part.part];
      for (let index = 0; index < pending.length; index++) {
        for (const edge of graph.outgoing(pending[index]!)) {
          if (edge.external || edge.targetPart === null) continue;
          if (!present.has(edge.targetPart)) missing.add(edge.targetPart);
          else if (!visited.has(edge.targetPart)) {
            visited.add(edge.targetPart);
            pending.push(edge.targetPart);
          }
        }
      }
      return [
        Object.freeze({
          part: part.part,
          kind,
          owners: Object.freeze(
            [...new Set(graph.incoming(part.part).map((edge) => edge.owner))].sort()
          ),
          dependencies: Object.freeze(pending.slice(1).sort()),
          missing: Object.freeze([...missing].sort()),
          semanticEditing: false as const
        })
      ];
    })
  );
}
