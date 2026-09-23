import type {
  MermaidDocument,
  MermaidLayoutOptions,
  MermaidScene
} from "./contracts.js";
import { layoutGraphDocument } from "./layout/graph.js";
import { layoutSequenceDocument } from "./layout/sequence.js";

export function layoutMermaid(
  document: MermaidDocument,
  options?: MermaidLayoutOptions
): MermaidScene {
  if (document.family === "sequence") {
    return layoutSequenceDocument(document, options);
  }
  return layoutGraphDocument(document, options);
}
