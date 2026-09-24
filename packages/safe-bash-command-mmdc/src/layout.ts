import {
  MermaidError,
  type MermaidDocument,
  type MermaidLayoutOptions,
  type MermaidScene
} from "./contracts.js";

import { layoutGraphDocument } from "./layout/graph.js";
import { layoutSequenceDocument } from "./layout/sequence.js";

export function layoutMermaid(
  document: MermaidDocument,
  options?: MermaidLayoutOptions
): MermaidScene {
  for (const dimension of ["width", "height"] as const) {
    const value = options?.[dimension];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new MermaidError("E_ARGUMENT", `Viewport ${dimension} must be a positive integer`);
    }
  }
  const scene = document.family === "sequence"
    ? layoutSequenceDocument(document, options)
    : layoutGraphDocument(document, options);
  const width = options?.width ?? (options?.height === undefined
    ? scene.width : Math.max(1, Math.round(options.height * scene.width / scene.height)));
  const height = options?.height ?? (options?.width === undefined
    ? scene.height : Math.max(1, Math.round(options.width * scene.height / scene.width)));
  return { ...scene, width, height };
}
