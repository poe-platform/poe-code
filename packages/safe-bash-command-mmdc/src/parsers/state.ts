import {
  MermaidError,
  type DocumentEdge,
  type DocumentGroup,
  type DocumentNode,
  type DocumentNote,
  type FlowDirection,
  type MermaidBudget,
  type MermaidDocument,
  type MermaidSourceSpan
} from "../contracts.js";
import {
  indexOfChar,
  readWord,
  stripQuotes,
  trimWhitespace
} from "../parser-utils.js";
import { checkSafeLabelText, type ScannedStatement } from "../scanner.js";

function parseStateDeclaration(
  rawAfterState: string,
  span: MermaidSourceSpan,
  budget: MermaidBudget
): { id: string; label: string; opensBlock: boolean } {
  let body = trimWhitespace(rawAfterState);
  let opensBlock = false;
  if (body.endsWith("{")) {
    opensBlock = true;
    body = trimWhitespace(body.slice(0, -1));
  }

  // Check for "as" keyword outside quotes: state "Label" as Alias
  let asIdx = -1;
  let q: string | null = null;
  for (let i = 0; i <= body.length - 4; i++) {
    const c = body[i]!;
    if (q !== null) {
      if (c === q && body[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (
      (c === " " || c === "\t") &&
      body.slice(i + 1, i + 3).toLowerCase() === "as" &&
      (body[i + 3] === " " || body[i + 3] === "\t")
    ) {
      asIdx = i;
      break;
    }
  }

  if (asIdx >= 0) {
    const rawLabel = stripQuotes(trimWhitespace(body.slice(0, asIdx)));
    const rawId = stripQuotes(trimWhitespace(body.slice(asIdx + 4)));
    if (!rawId) {
      throw new MermaidError("E_SYNTAX", "Missing state alias after 'as'", { span });
    }
    checkSafeLabelText(rawLabel, budget, span);
    return { id: rawId, label: rawLabel || rawId, opensBlock };
  }

  const clean = stripQuotes(body);
  if (!clean) {
    throw new MermaidError("E_SYNTAX", "Missing state identifier", { span });
  }
  checkSafeLabelText(clean, budget, span);
  return { id: clean, label: clean, opensBlock };
}

export function parseStateDiagram(
  statements: readonly ScannedStatement[],
  budget: MermaidBudget
): MermaidDocument {
  let direction: FlowDirection = "TD";
  const nodes = new Map<string, DocumentNode>();
  const groups = new Map<string, DocumentGroup>();
  const edges: DocumentEdge[] = [];
  const notes: DocumentNote[] = [];
  const groupStack: string[] = [];

  let startCounter = 0;
  let endCounter = 0;

  // Track start/end pseudostates per group scope so multiple transitions from [*] inside the same scope share the scope's start/end node
  const scopeStartNode = new Map<string, string>();
  const scopeEndNode = new Map<string, string>();

  const currentGroupId = (): string | undefined =>
    groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;

  const ensureStateNode = (
    id: string,
    label?: string,
    span?: MermaidSourceSpan
  ): string => {
    const cleanId = stripQuotes(trimWhitespace(id));
    if (!cleanId) {
      throw new MermaidError("E_SYNTAX", "Empty state identifier", { span });
    }
    // If cleanId is already a composite group, do not create a duplicate leaf node for it unless needed as endpoint
    const existing = nodes.get(cleanId);
    const display = label !== undefined ? checkSafeLabelText(label, budget, span) : cleanId;
    if (!existing) {
      budget.chargeNodes(1);
      nodes.set(cleanId, {
        id: cleanId,
        label: display,
        shape: "rounded",
        groupId: currentGroupId(),
        span
      });
    } else if (label !== undefined && existing.label === existing.id) {
      nodes.set(cleanId, {
        ...existing,
        label: display
      });
    }
    return cleanId;
  };

  const resolveEndpoint = (
    rawEndpoint: string,
    role: "source" | "target",
    span: MermaidSourceSpan
  ): string => {
    const trimmed = trimWhitespace(rawEndpoint);
    if (trimmed === "[*]") {
      const scopeKey = currentGroupId() ?? "__root__";
      if (role === "source") {
        let startId = scopeStartNode.get(scopeKey);
        if (!startId) {
          startId = `__state_start_${++startCounter}`;
          scopeStartNode.set(scopeKey, startId);
          budget.chargeNodes(1);
          nodes.set(startId, {
            id: startId,
            label: "",
            shape: "stateStart",
            groupId: currentGroupId(),
            span
          });
        }
        return startId;
      } else {
        let endId = scopeEndNode.get(scopeKey);
        if (!endId) {
          endId = `__state_end_${++endCounter}`;
          scopeEndNode.set(scopeKey, endId);
          budget.chargeNodes(1);
          nodes.set(endId, {
            id: endId,
            label: "",
            shape: "stateEnd",
            groupId: currentGroupId(),
            span
          });
        }
        return endId;
      }
    }
    return ensureStateNode(trimmed, undefined, span);
  };

  let pendingMultiLineNote: {
    position: "left" | "right";
    targetId: string;
    lines: string[];
    span: MermaidSourceSpan;
  } | null = null;

  for (let sIdx = 1; sIdx < statements.length; sIdx++) {
    const stmt = statements[sIdx]!;
    const text = stmt.text;
    const span: MermaidSourceSpan = {
      offset: stmt.offset,
      line: stmt.line,
      column: stmt.column,
      length: text.length
    };

    if (pendingMultiLineNote !== null) {
      if (text.toLowerCase() === "end note" || text.toLowerCase() === "endnote") {
        const noteText = checkSafeLabelText(
          pendingMultiLineNote.lines.join("\n"),
          budget,
          pendingMultiLineNote.span
        );
        notes.push({
          id: `state_note_${notes.length + 1}`,
          text: noteText,
          targetIds: [pendingMultiLineNote.targetId],
          position: pendingMultiLineNote.position,
          span: pendingMultiLineNote.span
        });
        pendingMultiLineNote = null;
      } else {
        pendingMultiLineNote.lines.push(text);
      }
      continue;
    }

    if (text === "}") {
      if (groupStack.length === 0) {
        throw new MermaidError("E_SYNTAX", "Unexpected '}' without open composite state", {
          span
        });
      }
      groupStack.pop();
      continue;
    }

    const { word: kw, next: afterKw } = readWord(text, 0);
    const lowerKw = kw.toLowerCase();

    if (lowerKw === "direction") {
      const dirRaw = trimWhitespace(text.slice(afterKw)).toUpperCase();
      if (
        dirRaw === "TB" ||
        dirRaw === "TD" ||
        dirRaw === "LR" ||
        dirRaw === "RL" ||
        dirRaw === "BT"
      ) {
        direction = dirRaw as FlowDirection;
        continue;
      }
      throw new MermaidError("E_SYNTAX", `Invalid stateDiagram direction '${dirRaw}'`, { span });
    }

    if (lowerKw === "note") {
      const rest = trimWhitespace(text.slice(afterKw));
      const colonIdx = indexOfChar(rest, ":");
      const headerPart = colonIdx >= 0 ? trimWhitespace(rest.slice(0, colonIdx)) : rest;
      const lowerHeader = headerPart.toLowerCase();
      let position: "left" | "right";
      let targetRaw: string;

      if (lowerHeader.startsWith("left of ")) {
        position = "left";
        targetRaw = trimWhitespace(headerPart.slice("left of ".length));
      } else if (lowerHeader.startsWith("right of ")) {
        position = "right";
        targetRaw = trimWhitespace(headerPart.slice("right of ".length));
      } else {
        throw new MermaidError(
          "E_SYNTAX",
          `Invalid stateDiagram note header '${headerPart}' (expected 'left of <State>' or 'right of <State>')`,
          { span }
        );
      }

      const targetId = ensureStateNode(targetRaw, undefined, span);
      if (colonIdx >= 0) {
        const noteText = checkSafeLabelText(
          stripQuotes(trimWhitespace(rest.slice(colonIdx + 1))),
          budget,
          span
        );
        notes.push({
          id: `state_note_${notes.length + 1}`,
          text: noteText,
          targetIds: [targetId],
          position,
          span
        });
      } else {
        pendingMultiLineNote = {
          position,
          targetId,
          lines: [],
          span
        };
      }
      continue;
    }

    if (lowerKw === "state") {
      const decl = parseStateDeclaration(text.slice(afterKw), span, budget);
      if (decl.opensBlock) {
        const parentId = currentGroupId();
        groups.set(decl.id, {
          id: decl.id,
          label: decl.label,
          parentId,
          kind: "compositeState",
          span
        });
        // If a leaf node was created for decl.id previously, keep its groupId updated
        if (nodes.has(decl.id)) {
          nodes.delete(decl.id);
        }
        groupStack.push(decl.id);
        budget.enterDepth(groupStack.length);
      } else {
        ensureStateNode(decl.id, decl.label, span);
      }
      continue;
    }

    // Check for composite state opening without 'state' keyword: e.g., CompositeName {
    if (text.endsWith("{") && !text.includes("-->")) {
      const rawId = stripQuotes(trimWhitespace(text.slice(0, -1)));
      if (!rawId) {
        throw new MermaidError("E_SYNTAX", "Missing composite state name before '{'", { span });
      }
      checkSafeLabelText(rawId, budget, span);
      const parentId = currentGroupId();
      groups.set(rawId, {
        id: rawId,
        label: rawId,
        parentId,
        kind: "compositeState",
        span
      });
      if (nodes.has(rawId)) {
        nodes.delete(rawId);
      }
      groupStack.push(rawId);
      budget.enterDepth(groupStack.length);
      continue;
    }

    // Check for transition: A --> B [: label]
    let arrowPos = -1;
    let q: string | null = null;
    for (let i = 0; i <= text.length - 3; i++) {
      const c = text[i]!;
      if (q !== null) {
        if (c === q && text[i - 1] !== "\\") q = null;
        continue;
      }
      if (c === '"' || c === "'") {
        q = c;
        continue;
      }
      if (text.startsWith("-->", i)) {
        arrowPos = i;
        break;
      }
    }

    if (arrowPos >= 0) {
      const leftPart = trimWhitespace(text.slice(0, arrowPos));
      const rightAndLabel = trimWhitespace(text.slice(arrowPos + 3));
      const colonIdx = indexOfChar(rightAndLabel, ":");
      const rightPart =
        colonIdx >= 0 ? trimWhitespace(rightAndLabel.slice(0, colonIdx)) : rightAndLabel;
      const transLabel =
        colonIdx >= 0
          ? checkSafeLabelText(
              stripQuotes(trimWhitespace(rightAndLabel.slice(colonIdx + 1))),
              budget,
              span
            )
          : undefined;

      if (!leftPart || !rightPart) {
        throw new MermaidError("E_SYNTAX", `Incomplete state transition '${text}'`, { span });
      }

      const fromId = resolveEndpoint(leftPart, "source", span);
      const toId = resolveEndpoint(rightPart, "target", span);
      budget.chargeEdges(1);
      edges.push({
        id: `state_edge_${edges.length + 1}`,
        from: fromId,
        to: toId,
        label: transLabel || undefined,
        lineStyle: "solid",
        startMarker: "none",
        endMarker: "arrow",
        span
      });
      continue;
    }

    // Check for state description: StateId : Description
    const colonIdx = indexOfChar(text, ":");
    if (colonIdx > 0) {
      const stateId = stripQuotes(trimWhitespace(text.slice(0, colonIdx)));
      const desc = checkSafeLabelText(
        stripQuotes(trimWhitespace(text.slice(colonIdx + 1))),
        budget,
        span
      );
      const existing = nodes.get(stateId);
      if (existing) {
        const combined =
          existing.label === existing.id ? `${existing.label}\n${desc}` : `${existing.label}\n${desc}`;
        checkSafeLabelText(combined, budget, span);
        nodes.set(stateId, { ...existing, label: combined });
      } else {
        ensureStateNode(stateId, `${stateId}\n${desc}`, span);
      }
      continue;
    }

    throw new MermaidError("E_SYNTAX", `Unrecognized stateDiagram statement: '${text}'`, {
      span
    });
  }

  if (pendingMultiLineNote !== null) {
    throw new MermaidError("E_SYNTAX", "Unclosed multi-line note in stateDiagram", {
      span: pendingMultiLineNote.span
    });
  }

  if (groupStack.length > 0) {
    throw new MermaidError(
      "E_SYNTAX",
      `Unclosed composite state '${groupStack[groupStack.length - 1]}'`,
      { span: groups.get(groupStack[groupStack.length - 1]!)?.span }
    );
  }

  // If any edge endpoints reference a composite state groupId directly, redirect them to an representative child node or ensure group node
  const finalEdges: DocumentEdge[] = edges.map((e) => {
    let from = e.from;
    let to = e.to;
    if (groups.has(from) && !nodes.has(from)) {
      const child = Array.from(nodes.values()).find((n) => n.groupId === from);
      if (child) from = child.id;
    }
    if (groups.has(to) && !nodes.has(to)) {
      const child = Array.from(nodes.values()).find((n) => n.groupId === to);
      if (child) to = child.id;
    }
    return { ...e, from, to };
  });

  return {
    family: "state",
    direction,
    nodes: Array.from(nodes.values()),
    groups: Array.from(groups.values()),
    edges: finalEdges,
    notes
  };
}
