import type { Attributes, DotGraph, NodeRef, Statement, Subgraph } from "./dot.js";
export interface ModelNode {
  id: string;
  attributes: Attributes;
}
export interface ModelEdge {
  tail: NodeRef;
  head: NodeRef;
  attributes: Attributes;
}
export interface ModelCluster {
  id: string;
  attributes: Attributes;
  nodes: string[];
  parent?: string;
}
export interface RankGroup {
  rank: string;
  nodes: string[];
}
export interface GraphModel {
  attributes: Attributes;
  nodes: ModelNode[];
  edges: ModelEdge[];
  clusters: ModelCluster[];
  ranks: RankGroup[];
}

/** Resolve lexical defaults, implicit nodes, subgraph edge products and strict edges. */
export function resolveGraph(graph: DotGraph): GraphModel {
  const nodes = new Map<string, ModelNode>();
  const edges: ModelEdge[] = [];
  const strictEdges = new Map<string, ModelEdge>();
  const clusters: ModelCluster[] = [];
  const ranks: RankGroup[] = [];
  interface Scope {
    graph: Attributes;
    node: Attributes;
    edge: Attributes;
  }
  function walk(
    statements: Statement[],
    inherited: Scope,
    cluster?: string
  ): { ids: string[]; attributes: Attributes } {
    const scope: Scope = {
      graph: { ...inherited.graph },
      node: { ...inherited.node },
      edge: { ...inherited.edge }
    };
    const ids = new Set<string>();
    const node = (ref: NodeRef, attributes: Attributes = {}) => {
      let existing = nodes.get(ref.id);
      if (!existing) {
        existing = { id: ref.id, attributes: { ...scope.node } };
        nodes.set(ref.id, existing);
      }
      Object.assign(existing.attributes, attributes);
      ids.add(ref.id);
      return ref;
    };
    const subgraph = (sub: Subgraph): NodeRef[] => {
      const isCluster = sub.id?.startsWith("cluster") ?? false;
      const nested = walk(sub.statements, scope, isCluster ? sub.id : cluster);
      for (const id of nested.ids) ids.add(id);
      if (isCluster)
        clusters.push({
          id: sub.id!,
          attributes: nested.attributes,
          nodes: nested.ids,
          ...(cluster !== undefined ? { parent: cluster } : {})
        });
      if (nested.attributes.rank) ranks.push({ rank: nested.attributes.rank, nodes: nested.ids });
      return nested.ids.map((id) => ({ id }));
    };
    for (const statement of statements) {
      if (statement.kind === "attributes")
        Object.assign(scope[statement.target], statement.attributes);
      else if (statement.kind === "node") node(statement.node, statement.attributes);
      else if (statement.kind === "subgraph") subgraph(statement);
      else {
        const endpoints = statement.endpoints.map((endpoint) =>
          "kind" in endpoint ? subgraph(endpoint) : [node(endpoint)]
        );
        for (let i = 1; i < endpoints.length; i++)
          for (const tail of endpoints[i - 1]!)
            for (const head of endpoints[i]!) {
              const pair =
                graph.directed || tail.id <= head.id ? [tail.id, head.id] : [head.id, tail.id];
              const key = JSON.stringify(pair);
              const existing = strictEdges.get(key);
              if (graph.strict && existing) {
                Object.assign(existing.attributes, statement.attributes);
                continue;
              }
              const edge = {
                tail: { ...tail },
                head: { ...head },
                attributes: { ...scope.edge, ...statement.attributes }
              };
              edges.push(edge);
              if (graph.strict) strictEdges.set(key, edge);
            }
      }
    }
    return { ids: [...ids], attributes: scope.graph };
  }
  const root = walk(graph.statements, { graph: {}, node: {}, edge: {} });
  return { attributes: root.attributes, nodes: [...nodes.values()], edges, clusters, ranks };
}
