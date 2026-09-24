import {
  MermaidBudget,
  MermaidError,
  type DocumentEdge,
  type DocumentGroup,
  type DocumentNode,
  type EdgeLineStyle,
  type EdgeMarkerKind,
  type FlowDirection,
  type MermaidDocument,
  type MermaidSourceSpan,
  type NodeShape
} from "../contracts.js";
import {
  checkSafeLabelText,
  isAsciiWhitespace,
  isIdentifierChar,
  unquoteText,
  type ScannedStatement
} from "../scanner.js";

const VALID_DIRECTIONS: readonly FlowDirection[] = ["TB", "TD", "BT", "LR", "RL"];

const UNSUPPORTED_FLOWCHART_KEYWORDS = [
  "click",
  "classDef",
  "class",
  "style",
  "linkStyle",
  "callback"
];

interface ParsedNodeRef {
  readonly id: string;
  readonly label?: string | undefined;
  readonly shape?: NodeShape | undefined;
  readonly accent?: boolean | undefined;
  readonly span: MermaidSourceSpan;
}

interface ParsedEdgeOp {
  readonly lineStyle: EdgeLineStyle;
  readonly startMarker: EdgeMarkerKind;
  readonly endMarker: EdgeMarkerKind;
  readonly label?: string | undefined;
  readonly nextPos: number;
}

function skipWs(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && isAsciiWhitespace(text[i]!)) i++;
  return i;
}

function readWord(text: string, pos: number): { word: string; nextPos: number } {
  let i = pos;
  while (i < text.length && !isAsciiWhitespace(text[i]!)) i++;
  return { word: text.slice(pos, i), nextPos: i };
}

function readBalancedBracket(
  text: string,
  openPos: number,
  openSeq: string,
  closeSeq: string,
  span: MermaidSourceSpan
): { content: string; nextPos: number } {
  let i = openPos + openSeq.length;
  let inQuote: '"' | "'" | null = null;
  const contentStart = i;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuote !== null) {
      if (ch === "\\" && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      i++;
      continue;
    }
    if (text.startsWith(closeSeq, i)) {
      return {
        content: text.slice(contentStart, i),
        nextPos: i + closeSeq.length
      };
    }
    i++;
  }
  throw new MermaidError("E_SYNTAX", `Unclosed node shape '${openSeq}...${closeSeq}'`, { span });
}

function parseSingleNodeRef(
  text: string,
  startPos: number,
  stmt: ScannedStatement,
  budget: MermaidBudget
): { node: ParsedNodeRef; nextPos: number } {
  const pos = skipWs(text, startPos);
  let i = pos;
  while (i < text.length && isIdentifierChar(text[i]!)) i++;
  if (i === pos) {
    throw new MermaidError(
      "E_SYNTAX",
      `Expected node identifier at '${text.slice(pos, pos + 16)}'`,
      {
        span: {
          offset: stmt.offset + pos,
          line: stmt.line,
          column: stmt.column + pos
        }
      }
    );
  }
  const id = text.slice(pos, i);
  const span: MermaidSourceSpan = {
    offset: stmt.offset + pos,
    line: stmt.line,
    column: stmt.column + pos,
    length: id.length
  };

  let shape: NodeShape | undefined;
  let accent: boolean | undefined;
  let rawLabel: string | undefined;

  if (text.startsWith("([", i)) {
    const res = readBalancedBracket(text, i, "([", "])", span);
    shape = "stadium";
    accent = true;
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("((", i)) {
    const res = readBalancedBracket(text, i, "((", "))", span);
    shape = "circle";
    accent = true;
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("[(", i)) {
    const res = readBalancedBracket(text, i, "[(", ")]", span);
    shape = "cylinder";
    accent = true;
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("[[", i)) {
    const res = readBalancedBracket(text, i, "[[", "]]", span);
    shape = "subroutine";
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("{{", i)) {
    const res = readBalancedBracket(text, i, "{{", "}}", span);
    shape = "hexagon";
    accent = true;
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("[", i)) {
    const res = readBalancedBracket(text, i, "[", "]", span);
    shape = "rect";
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("(", i)) {
    const res = readBalancedBracket(text, i, "(", ")", span);
    shape = "rounded";
    rawLabel = res.content;
    i = res.nextPos;
  } else if (text.startsWith("{", i)) {
    const res = readBalancedBracket(text, i, "{", "}", span);
    shape = "diamond";
    accent = true;
    rawLabel = res.content;
    i = res.nextPos;
  }

  const label =
    rawLabel !== undefined
      ? checkSafeLabelText(unquoteText(rawLabel), budget, span)
      : undefined;

  return {
    node: { id, label, shape, accent, span },
    nextPos: i
  };
}

function parseNodeGroup(
  text: string,
  startPos: number,
  stmt: ScannedStatement,
  budget: MermaidBudget
): { nodes: readonly ParsedNodeRef[]; nextPos: number } {
  const nodes: ParsedNodeRef[] = [];
  let cursor = startPos;
  while (true) {
    const single = parseSingleNodeRef(text, cursor, stmt, budget);
    nodes.push(single.node);
    cursor = skipWs(text, single.nextPos);
    if (text[cursor] === "&") {
      cursor = skipWs(text, cursor + 1);
      continue;
    }
    break;
  }
  return { nodes, nextPos: cursor };
}

function tryParseEdgeOp(
  text: string,
  startPos: number,
  stmt: ScannedStatement,
  budget: MermaidBudget
): ParsedEdgeOp | undefined {
  const pos = skipWs(text, startPos);
  if (pos >= text.length) return undefined;

  const rest = text.slice(pos);
  const span: MermaidSourceSpan = {
    offset: stmt.offset + pos,
    line: stmt.line,
    column: stmt.column + pos
  };

  let lineStyle: EdgeLineStyle | undefined;
  let startMarker: EdgeMarkerKind = "none";
  let endMarker: EdgeMarkerKind = "none";
  let opLen = 0;
  let inlineLabel: string | undefined;

  // Check standard fixed edge operators (longest match first)
  const fixedOps: readonly {
    readonly token: string;
    readonly style: EdgeLineStyle;
    readonly start: EdgeMarkerKind;
    readonly end: EdgeMarkerKind;
  }[] = [
    { token: "<-.->", style: "dotted", start: "arrow", end: "arrow" },
    { token: "<-->", style: "solid", start: "arrow", end: "arrow" },
    { token: "<==>", style: "thick", start: "arrow", end: "arrow" },
    { token: "-..->", style: "dotted", start: "none", end: "arrow" },
    { token: "-.->", style: "dotted", start: "none", end: "arrow" },
    { token: "--->", style: "solid", start: "none", end: "arrow" },
    { token: "===>", style: "thick", start: "none", end: "arrow" },
    { token: "-.-", style: "dotted", start: "none", end: "none" },
    { token: "-->", style: "solid", start: "none", end: "arrow" },
    { token: "---", style: "solid", start: "none", end: "none" },
    { token: "==>", style: "thick", start: "none", end: "arrow" },
    { token: "===", style: "thick", start: "none", end: "none" },
    { token: "--x", style: "solid", start: "none", end: "cross" },
    { token: "--o", style: "solid", start: "none", end: "openArrow" }
  ];

  for (const candidate of fixedOps) {
    if (rest.startsWith(candidate.token)) {
      lineStyle = candidate.style;
      startMarker = candidate.start;
      endMarker = candidate.end;
      opLen = candidate.token.length;
      break;
    }
  }

  // Check inline labeled edge operators:
  // -- label --> or -- label ---
  // -. label .-> or -. label -.-
  // == label ==> or == label ===
  if (lineStyle === undefined) {
    if (rest.startsWith("-.")) {
      const closeArrow = rest.indexOf(".->", 2);
      const closeLine = rest.indexOf("-.-", 2);
      const closeIdx =
        closeArrow >= 0 && (closeLine < 0 || closeArrow < closeLine) ? closeArrow : closeLine;
      if (closeIdx >= 2) {
        lineStyle = "dotted";
        endMarker = closeIdx === closeArrow ? "arrow" : "none";
        inlineLabel = unquoteText(rest.slice(2, closeIdx));
        opLen = closeIdx + 3;
      }
    } else if (rest.startsWith("--")) {
      const closeArrow = rest.indexOf("-->", 2);
      const closeLine = rest.indexOf("---", 2);
      const closeIdx =
        closeArrow >= 0 && (closeLine < 0 || closeArrow < closeLine) ? closeArrow : closeLine;
      if (closeIdx >= 2) {
        lineStyle = "solid";
        endMarker = closeIdx === closeArrow ? "arrow" : "none";
        inlineLabel = unquoteText(rest.slice(2, closeIdx));
        opLen = closeIdx + 3;
      }
    } else if (rest.startsWith("==")) {
      const closeArrow = rest.indexOf("==>", 2);
      const closeLine = rest.indexOf("===", 2);
      const closeIdx =
        closeArrow >= 0 && (closeLine < 0 || closeArrow < closeLine) ? closeArrow : closeLine;
      if (closeIdx >= 2) {
        lineStyle = "thick";
        endMarker = closeIdx === closeArrow ? "arrow" : "none";
        inlineLabel = unquoteText(rest.slice(2, closeIdx));
        opLen = closeIdx + 3;
      }
    }
  }

  if (lineStyle === undefined) {
    return undefined;
  }

  let cursor = skipWs(text, pos + opLen);
  let label = inlineLabel;

  // Check for pipe label |...|
  if (text[cursor] === "|") {
    const closePipe = text.indexOf("|", cursor + 1);
    if (closePipe < 0) {
      throw new MermaidError("E_SYNTAX", "Unclosed edge label pipe '|'", { span });
    }
    label = unquoteText(text.slice(cursor + 1, closePipe));
    cursor = closePipe + 1;
  }

  if (label !== undefined) {
    label = checkSafeLabelText(label, budget, span);
  }

  return {
    lineStyle,
    startMarker,
    endMarker,
    label,
    nextPos: cursor
  };
}

export function parseFlowchart(
  statements: readonly ScannedStatement[],
  budget: MermaidBudget
): MermaidDocument {
  const headerStmt = statements[0]!;
  const headerText = headerStmt.text;
  const firstWord = readWord(headerText, 0);
  const keyword = firstWord.word;
  if (keyword !== "flowchart" && keyword !== "graph") {
    throw new MermaidError("E_SYNTAX", `Expected 'flowchart' or 'graph', got '${keyword}'`, {
      span: { offset: headerStmt.offset, line: headerStmt.line, column: headerStmt.column }
    });
  }

  let direction: FlowDirection = "TB";
  const afterKw = skipWs(headerText, firstWord.nextPos);
  if (afterKw < headerText.length) {
    const dirWord = readWord(headerText, afterKw);
    if (!VALID_DIRECTIONS.includes(dirWord.word as FlowDirection)) {
      throw new MermaidError(
        "E_SYNTAX",
        `Invalid flowchart direction '${dirWord.word}'. Supported: TB, TD, BT, LR, RL`,
        {
          span: {
            offset: headerStmt.offset + afterKw,
            line: headerStmt.line,
            column: headerStmt.column + afterKw
          }
        }
      );
    }
    direction = dirWord.word as FlowDirection;
    const trailing = skipWs(headerText, dirWord.nextPos);
    if (trailing < headerText.length) {
      throw new MermaidError(
        "E_SYNTAX",
        `Unexpected tokens after flowchart header: '${headerText.slice(trailing)}'`,
        {
          span: {
            offset: headerStmt.offset + trailing,
            line: headerStmt.line,
            column: headerStmt.column + trailing
          }
        }
      );
    }
  }

  const nodeMap = new Map<string, DocumentNode>();
  const groups: DocumentGroup[] = [];
  const edges: DocumentEdge[] = [];
  const groupStack: string[] = [];
  let title: string | undefined;
  let description: string | undefined;
  let autoGroupCounter = 0;

  const upsertNode = (ref: ParsedNodeRef): void => {
    const currentGroup = groupStack[groupStack.length - 1];
    const existing = nodeMap.get(ref.id);
    if (!existing) {
      budget.chargeNodes(1);
      nodeMap.set(ref.id, {
        id: ref.id,
        label: ref.label ?? ref.id,
        shape: ref.shape ?? "rect",
        groupId: currentGroup,
        accent: ref.accent,
        span: ref.span
      });
    } else {
      nodeMap.set(ref.id, {
        id: existing.id,
        label: ref.label ?? existing.label,
        shape: ref.shape ?? existing.shape,
        groupId: existing.groupId ?? currentGroup,
        accent: ref.accent ?? existing.accent,
        span: existing.span ?? ref.span
      });
    }
  };

  for (let sIdx = 1; sIdx < statements.length; sIdx++) {
    const stmt = statements[sIdx]!;
    const text = stmt.text;
    const span: MermaidSourceSpan = {
      offset: stmt.offset,
      line: stmt.line,
      column: stmt.column
    };

    const { word: kw, nextPos: afterKwPos } = readWord(text, 0);

    if (UNSUPPORTED_FLOWCHART_KEYWORDS.includes(kw)) {
      throw new MermaidError(
        "E_UNSUPPORTED",
        `Flowchart directive '${kw}' is not supported in the safe-bash mmdc profile`,
        { span }
      );
    }

    if (kw === "accTitle:" || kw === "title") {
      title = checkSafeLabelText(unquoteText(text.slice(afterKwPos)), budget, span);
      continue;
    }

    if (kw === "accDescr:") {
      description = checkSafeLabelText(unquoteText(text.slice(afterKwPos)), budget, span);
      continue;
    }

    if (kw === "direction") {
      const dirArg = text.slice(afterKwPos).trim();
      if (!VALID_DIRECTIONS.includes(dirArg as FlowDirection)) {
        throw new MermaidError("E_SYNTAX", `Invalid direction '${dirArg}'`, { span });
      }
      if (groupStack.length === 0) {
        direction = dirArg as FlowDirection;
      }
      continue;
    }

    if (kw === "subgraph") {
      const rest = text.slice(afterKwPos).trim();
      if (!rest) {
        throw new MermaidError("E_SYNTAX", "Subgraph declaration requires an identifier or title", {
          span
        });
      }
      let sgId: string;
      let sgLabel: string;
      if (rest.startsWith('"') || rest.startsWith("'")) {
        autoGroupCounter++;
        sgId = `subgraph_${autoGroupCounter}`;
        sgLabel = checkSafeLabelText(unquoteText(rest), budget, span);
      } else {
        const bracketIdx = rest.indexOf("[");
        if (bracketIdx > 0 && rest.endsWith("]")) {
          sgId = rest.slice(0, bracketIdx).trim();
          sgLabel = checkSafeLabelText(
            unquoteText(rest.slice(bracketIdx + 1, -1)),
            budget,
            span
          );
        } else {
          const w = readWord(rest, 0);
          sgId = w.word;
          const tail = rest.slice(w.nextPos).trim();
          sgLabel = checkSafeLabelText(
            tail.length > 0 ? unquoteText(tail) : sgId,
            budget,
            span
          );
        }
      }
      const parentId = groupStack[groupStack.length - 1];
      groupStack.push(sgId);
      budget.enterDepth(groupStack.length);
      groups.push({
        id: sgId,
        label: sgLabel,
        parentId,
        kind: "subgraph",
        span
      });
      continue;
    }

    if (kw === "end") {
      const trailing = text.slice(afterKwPos).trim();
      if (trailing.length > 0) {
        throw new MermaidError("E_SYNTAX", `Unexpected tokens after 'end': '${trailing}'`, {
          span
        });
      }
      if (groupStack.length === 0) {
        throw new MermaidError("E_SYNTAX", "Unexpected 'end' without matching 'subgraph'", {
          span
        });
      }
      groupStack.pop();
      continue;
    }

    // Parse node(s) and optional chained edges
    const firstGroup = parseNodeGroup(text, 0, stmt, budget);
    for (const n of firstGroup.nodes) upsertNode(n);

    let leftNodes = firstGroup.nodes;
    let cursor = skipWs(text, firstGroup.nextPos);

    while (cursor < text.length) {
      const edgeOp = tryParseEdgeOp(text, cursor, stmt, budget);
      if (!edgeOp) {
        throw new MermaidError(
          "E_SYNTAX",
          `Unexpected flowchart syntax near '${text.slice(cursor, cursor + 24)}'`,
          {
            span: {
              offset: stmt.offset + cursor,
              line: stmt.line,
              column: stmt.column + cursor
            }
          }
        );
      }
      const rightGroup = parseNodeGroup(text, edgeOp.nextPos, stmt, budget);
      for (const n of rightGroup.nodes) upsertNode(n);

      for (const src of leftNodes) {
        for (const dst of rightGroup.nodes) {
          budget.chargeEdges(1);
          edges.push({
            id: `edge_${edges.length + 1}`,
            from: src.id,
            to: dst.id,
            label: edgeOp.label,
            lineStyle: edgeOp.lineStyle,
            startMarker: edgeOp.startMarker,
            endMarker: edgeOp.endMarker,
            span
          });
        }
      }

      leftNodes = rightGroup.nodes;
      cursor = skipWs(text, rightGroup.nextPos);
    }
  }

  if (groupStack.length > 0) {
    throw new MermaidError(
      "E_SYNTAX",
      `Unclosed subgraph '${groupStack[groupStack.length - 1]}' at end of diagram`,
      { span: { offset: headerStmt.offset, line: headerStmt.line, column: headerStmt.column } }
    );
  }

  return {
    family: "flowchart",
    direction,
    title,
    description,
    nodes: Array.from(nodeMap.values()),
    groups,
    edges,
    notes: []
  };
}
