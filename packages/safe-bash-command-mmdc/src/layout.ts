import type {
  MermaidDocument,
  MermaidLayoutOptions,
  MermaidScene
} from "./contracts.js";
import { layoutGraphDocument } from "./layout/graph.js";

export function layoutMermaid(
  document: MermaidDocument,
  options?: MermaidLayoutOptions
): MermaidScene {
  return layoutGraphDocument(document, options);
}
