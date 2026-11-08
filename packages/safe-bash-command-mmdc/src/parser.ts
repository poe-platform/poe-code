import { parseJourney } from "./parsers/journey.js";
import { parseGitGraph } from "./parsers/gitGraph.js";
import { parseTimeline } from "./parsers/timeline.js";
import { parseGantt } from "./parsers/gantt.js";
import { parseMindmap } from "./parsers/mindmap.js";
import { drainWork } from "./work.js";
import { scanStatementsSteps } from "./scanner.js";
import { parseFlowchartSteps } from "./parsers/flowchart.js";
import { parseSequenceDiagramSteps } from "./parsers/sequence.js";
import { parseStateDiagramSteps } from "./parsers/state.js";
import { parseClassDiagramSteps } from "./parsers/class.js";
import { parseErDiagramSteps } from "./parsers/er.js";
import { parsePie } from "./parsers/pie.js";
import {
  admitMermaidLimits,
  MermaidBudget,
  MermaidError,
  type MermaidDocument,
  type MermaidParseOptions
} from "./contracts.js";





import { readWord } from "./parser-utils.js";


export function* parseMermaidSteps(
  source: string,
  options?: MermaidParseOptions
): Generator<void, MermaidDocument, void> {
  yield;



  const limits = admitMermaidLimits(options?.limits);
  const budget = options?.budget ?? new MermaidBudget(limits, options?.signal);
  const metadata: { title?: string; config?: Record<string, unknown> } = {};
  const statements = (yield* scanStatementsSteps(source, budget, metadata));
  const complete = (document: MermaidDocument): MermaidDocument => ({ ...document, title: document.title ?? metadata.title, config: metadata.config });
  const first = statements[0]!;
  const headWord = readWord(first.text, 0).word;

  if (headWord === "flowchart" || headWord === "graph") {
    return complete(yield* parseFlowchartSteps(statements, budget));
  }
  if (headWord === "sequenceDiagram") {
    return complete(yield* parseSequenceDiagramSteps(statements, budget));
  }
  if (headWord === "stateDiagram-v2" || headWord === "stateDiagram") {
    return complete(yield* parseStateDiagramSteps(statements, budget));
  }
  if (headWord === "classDiagram") {
    return complete(yield* parseClassDiagramSteps(statements, budget));
  }
  if (headWord === "erDiagram") {
    return complete(yield* parseErDiagramSteps(statements, budget));
  }

  if (headWord === "mindmap") return complete(yield* parseMindmap(statements, budget));

  if (headWord === "gantt") return complete(yield* parseGantt(statements, budget));

  if (headWord === "timeline") return complete(yield* parseTimeline(statements, budget));

  if (headWord === "gitGraph") return complete(yield* parseGitGraph(statements, budget));

  if (headWord === "journey") return complete(yield* parseJourney(statements, budget));

  if (headWord === "pie") return complete(parsePie(statements, budget));

  throw new MermaidError(
    "E_UNSUPPORTED",
    `Unsupported or unrecognized Mermaid diagram family '${headWord}'`,
    {
      span: {
        offset: first.offset,
        line: first.line,
        column: first.column,
        length: headWord.length
      }
    }
  );
}

export function parseMermaid(source: string, options?: MermaidParseOptions): MermaidDocument {
  return drainWork(parseMermaidSteps(source, options));
}
