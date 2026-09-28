import { drainWork } from "./work.js";
import { scanStatementsSteps } from "./scanner.js";
import { parseFlowchartSteps } from "./parsers/flowchart.js";
import { parseSequenceDiagramSteps } from "./parsers/sequence.js";
import { parseStateDiagramSteps } from "./parsers/state.js";
import { parseClassDiagramSteps } from "./parsers/class.js";
import { parseErDiagramSteps } from "./parsers/er.js";
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
  const statements = (yield* scanStatementsSteps(source, budget));
  const first = statements[0]!;
  const headWord = readWord(first.text, 0).word;

  if (headWord === "flowchart" || headWord === "graph") {
    return (yield* parseFlowchartSteps(statements, budget));
  }
  if (headWord === "sequenceDiagram") {
    return (yield* parseSequenceDiagramSteps(statements, budget));
  }
  if (headWord === "stateDiagram-v2" || headWord === "stateDiagram") {
    return (yield* parseStateDiagramSteps(statements, budget));
  }
  if (headWord === "classDiagram") {
    return (yield* parseClassDiagramSteps(statements, budget));
  }
  if (headWord === "erDiagram") {
    return (yield* parseErDiagramSteps(statements, budget));
  }

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
