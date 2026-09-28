import { drainWork } from "./work.js";
import { layoutGraphDocumentSteps } from "./layout/graph.js";
import { layoutSequenceDocumentSteps } from "./layout/sequence.js";
import {
  MermaidError,
  type MermaidDocument,
  type MermaidLayoutOptions,
  type MermaidScene
} from "./contracts.js";




export function* layoutMermaidSteps(
  document: MermaidDocument,
  options?: MermaidLayoutOptions
): Generator<void, MermaidScene, void> {
  yield;

  let work = 0;

  for (const dimension of ["width", "height"] as const) {
    if (++work % 256 === 0) yield;

    const value = options?.[dimension];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new MermaidError("E_ARGUMENT", `Viewport ${dimension} must be a positive integer`);
    }
  }
  const scene = document.family === "sequence"
    ? (yield* layoutSequenceDocumentSteps(document, options))
    : (yield* layoutGraphDocumentSteps(document, options));
  const width = options?.width ?? (options?.height === undefined
    ? scene.width : Math.max(1, Math.round(options.height * scene.width / scene.height)));
  const height = options?.height ?? (options?.width === undefined
    ? scene.height : Math.max(1, Math.round(options.width * scene.height / scene.width)));
  return { ...scene, width, height };
}

export function layoutMermaid(document: MermaidDocument, options?: MermaidLayoutOptions): MermaidScene {
  return drainWork(layoutMermaidSteps(document, options));
}
