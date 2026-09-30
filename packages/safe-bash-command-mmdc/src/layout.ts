import { measureLineWidth } from "./text.js";
import { drainWork } from "./work.js";
import { layoutGraphDocumentSteps } from "./layout/graph.js";
import { layoutSequenceDocumentSteps } from "./layout/sequence.js";
import { layoutPie } from "./layout/pie.js";
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
  let scene = document.family === "pie" ? layoutPie(document, options) : document.family === "sequence"
    ? (yield* layoutSequenceDocumentSteps(document, options))
    : (yield* layoutGraphDocumentSteps(document, options));
  if (document.title && document.family !== "pie") {
    const textWidth = measureLineWidth(document.title, 16, "ui", 600);
    const width = Math.max(scene.width, textWidth + scene.padding * 2);
    const height = scene.height + 24 + scene.padding;
    scene = { ...scene, width, height, viewBox: { ...scene.viewBox, width, height }, naturalBounds: { width, height },
      nodes: [...scene.nodes, { id: "mmdc_title", shape: "rect", x: scene.padding, y: scene.height,
        width: width - scene.padding * 2, height: 24, rx: 0, fill: scene.theme.surface,
        stroke: "transparent", strokeWidth: 0, shadow: false, dividers: [], badges: [],
        lines: [{ text: document.title, width: textWidth, x: width / 2, y: scene.height + 18,
          color: scene.theme.text, fontSize: 16, fontWeight: 600, fontFamily: "ui", align: "center" }] }] };
  }
  const width = options?.width ?? (options?.height === undefined
    ? scene.width : Math.max(1, Math.round(options.height * scene.width / scene.height)));
  const height = options?.height ?? (options?.width === undefined
    ? scene.height : Math.max(1, Math.round(options.width * scene.height / scene.width)));
  return { ...scene, width, height };
}

export function layoutMermaid(document: MermaidDocument, options?: MermaidLayoutOptions): MermaidScene {
  return drainWork(layoutMermaidSteps(document, options));
}
