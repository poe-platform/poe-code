import {
  admitMermaidLimits,
  MermaidBudget,
  MermaidError,
  type MermaidDocument,
  type MermaidParseOptions
} from "./contracts.js";
import { parseFlowchart } from "./parsers/flowchart.js";
import { readWord } from "./parser-utils.js";
import { scanStatements } from "./scanner.js";

export function parseMermaid(
  source: string,
  options?: MermaidParseOptions
): MermaidDocument {
  const limits = admitMermaidLimits(options?.limits);
  const budget = options?.budget ?? new MermaidBudget(limits, options?.signal);
  const statements = scanStatements(source, budget);
  const first = statements[0]!;
  const headWord = readWord(first.text, 0).word;

  if (headWord === "flowchart" || headWord === "graph") {
    return parseFlowchart(statements, budget);
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
