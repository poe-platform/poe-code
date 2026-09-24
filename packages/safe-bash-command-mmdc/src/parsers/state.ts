import {
  MermaidError,
  type DocumentEdge,
  type DocumentGroup,
  type DocumentNode,
  type DocumentNote,
  type FlowDirection,
  type MermaidBudget,
  type MermaidDocument,
  type MermaidSourceSpan,
  type NodeShape
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
): { id: string; label: string; opensBlock: boolean; shape?: NodeShape | undefined; stereotype?: string | undefined } {
  let body = trimWhitespace(rawAfterState);
  let opensBlock = false;
  if (body.endsWith("{")) {
    opensBlock = true;
    body = trimWhitespace(body.slice(0, -1));
  }

  let shape: NodeShape | undefined;
  let stereotype: string | undefined;
  const stereoMatch = body.match(/<<\s*([a-zA-Z0-9_-]+)\s*>>\s*$/);
  if (stereoMatch) {
    const kind = stereoMatch[1]!.toLowerCase();
    body = trimWhitespace(body.slice(0, body.length - stereoMatch[0].length));
    if (kind === "choice") {
      shape = "diamond";
    } else if (kind === "fork" || kind === "join") {
      shape = "rect";
      stereotype = kind;
    } else {
      stereotype = stereoMatch[1]!;
    }
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
    if (c === "\"" || c === "'") {
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
    return {
      id: rawId,
      label: shape === "diamond" && rawLabel === rawId ? "?" : rawLabel || rawId,
      opensBlock,
      shape,
      stereotype
    };
  }

  const clean = stripQuotes(body);
  if (!clean) {
    throw new MermaidError("E_SYNTAX", "Missing state identifier", { span });
  }
  checkSafeLabelText(clean, budget, span);
  return {
    id: clean,
    label: shape === "diamond" ? "?" : clean,
    opensBlock,
    shape,
    stereotype
  };
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

  const scopeStartNode = new Map<string, string>();
  const scopeEndNode = new Map<string, string>();

  const currentGroupId = (): string | undefined =>
    groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;

  const ensureStateNode = (
    id: string,
    label?: string,
    span?: MermaidSourceSpan,
    shape?: NodeShape
  ): string => {
    const cleanId = stripQuotes(trimWhitespace(id));
    if (!cleanId) {
      throw new MermaidError("E_SYNTAX", "Empty state identifier", { span });
    }
    const existing = nodes.get(cleanId);
    const display = label !== undefined ? checkSafeLabelText(label, budget, span) : cleanId;
    if (!existing) {
      budget.chargeNodes(1);
      nodes.set(cleanId, {
        id: cleanId,
        label: display,
        shape: shape ?? "rounded",
        accent: shape === "diamond" ? true : undefined,
        groupId: currentGroupId(),
        span
      });
    } else {
      const updatedLabel =
        label !== undefined && existing.label === existing.id ? display : existing.label;
      const updatedShape = shape ?? existing.shape;
      nodes.set(cleanId, {
        ...existing,
        label: updatedLabel,
        shape: updatedShape,
        accent: updatedShape === "diamond" ? true : existing.accent
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
        groupStack.push(decl.id);
        budget.enterDepth(groupStack.length);
      } else {
        ensureStateNode(decl.id, decl.label, span, decl.shape);
      }
      continue;
    }

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
      groupStack.push(rawId);
      budget.enterDepth(groupStack.length);
      continue;
    }

    let arrowPos = -1;
    let q: string | null = null;
    for (let i = 0; i <= text.length - 3; i++) {
      const c = text[i]!;
      if (q !== null) {
        if (c === q && text[i - 1] !== "\\") q = null;
        continue;
      }
      if (c === "\"" || c === "'") {
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
        label: transLabel,
        lineStyle: "solid",
        startMarker: "none",
        endMarker: "arrow",
        span
      });
      continue;
    }

    // Support StateId : Description syntax
    const descColonIdx = indexOfChar(text, ":");
    if (descColonIdx > 0) {
      const stId = stripQuotes(trimWhitespace(text.slice(0, descColonIdx)));
      const descText = stripQuotes(trimWhitespace(text.slice(descColonIdx + 1)));
      if (stId && descText) {
        const safeDesc = checkSafeLabelText(descText, budget, span);
        if (groups.has(stId)) {
          const g = groups.get(stId)!;
          groups.set(stId, { ...g, label: g.label === stId ? `${stId} — ${safeDesc}` : g.label });
        } else {
          const existing = nodes.get(stId);
          const combinedLabel =
            existing && existing.label !== existing.id
              ? `${existing.label}\n${safeDesc}`
              : `${stId}\n${safeDesc}`;
          ensureStateNode(stId, combinedLabel, span);
        }
        continue;
      }
    }

    throw new MermaidError(
      "E_SYNTAX",
      `Unknown or unsupported stateDiagram statement '${text}'`,
      { span }
    );
  }

  if (pendingMultiLineNote !== null) {
    throw new MermaidError("E_SYNTAX", "Unclosed multi-line note block (missing 'end note')", {
      span: pendingMultiLineNote.span
    });
  }

  if (groupStack.length > 0) {
    throw new MermaidError(
      "E_SYNTAX",
      `Unclosed composite state '${groupStack[groupStack.length - 1]}' (missing '}')`
    );
  }

  // Resolve transitions targeting or exiting composite states to their internal entry/exit states,
  // and remove any duplicate leaf nodes whose id collides with a non-empty composite state group.
  const findGroupEntryLeaf = (gid: string, visitedGroups = new Set<string>()): string | undefined => {
    if (visitedGroups.has(gid)) return undefined;
    visitedGroups.add(gid);
    const children = [...nodes.values()].filter((n) => n.groupId === gid && !groups.has(n.id));
    if (children.length > 0) {
      const startPseudo = scopeStartNode.get(gid);
      if (startPseudo && nodes.has(startPseudo)) {
        return startPseudo;
      }
      const childIds = new Set(children.map((c) => c.id));
      const inDeg = new Map<string, number>();
      for (const c of children) inDeg.set(c.id, 0);
      for (const e of edges) {
        if (childIds.has(e.from) && childIds.has(e.to) && e.from !== e.to) {
          inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
        }
      }
      const zeroIn = children.find((c) => (inDeg.get(c.id) ?? 0) === 0);
      return (zeroIn ?? children[0]!).id;
    }
    const childGroups = [...groups.values()].filter((g) => g.parentId === gid);
    for (const cg of childGroups) {
      const nested = findGroupEntryLeaf(cg.id, visitedGroups);
      if (nested) return nested;
    }
    return undefined;
  };

  const findGroupExitLeaf = (gid: string, visitedGroups = new Set<string>()): string | undefined => {
    if (visitedGroups.has(gid)) return undefined;
    visitedGroups.add(gid);
    const children = [...nodes.values()].filter((n) => n.groupId === gid && !groups.has(n.id));
    if (children.length > 0) {
      const endPseudo = scopeEndNode.get(gid);
      if (endPseudo && nodes.has(endPseudo)) return endPseudo;
      const nonStart = children.filter((c) => c.shape !== "stateStart");
      const pool = nonStart.length > 0 ? nonStart : children;
      const childIds = new Set(pool.map((c) => c.id));
      const outDeg = new Map<string, number>();
      for (const c of pool) outDeg.set(c.id, 0);
      for (const e of edges) {
        if (childIds.has(e.from) && childIds.has(e.to) && e.from !== e.to) {
          outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
        }
      }
      const sinks = pool.filter((c) => (outDeg.get(c.id) ?? 0) === 0);
      return (sinks[sinks.length - 1] ?? pool[pool.length - 1]!).id;
    }
    const childGroups = [...groups.values()].filter((g) => g.parentId === gid);
    for (let i = childGroups.length - 1; i >= 0; i--) {
      const nested = findGroupExitLeaf(childGroups[i]!.id, visitedGroups);
      if (nested) return nested;
    }
    return undefined;
  };

  for (const gid of groups.keys()) {
    const entryLeaf = findGroupEntryLeaf(gid);
    const exitLeaf = findGroupExitLeaf(gid);
    if (entryLeaf && exitLeaf) {
      nodes.delete(gid);
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const newFrom = e.from === gid ? exitLeaf : e.from;
        const newTo = e.to === gid ? entryLeaf : e.to;
        if (newFrom !== e.from || newTo !== e.to) {
          edges[i] = { ...e, from: newFrom, to: newTo };
        }
      }
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i]!;
        if (n.targetIds.includes(gid)) {
          notes[i] = {
            ...n,
            targetIds: n.targetIds.map((tid) => (tid === gid ? entryLeaf : tid))
          };
        }
      }
    }
  }

  return {
    family: "state",
    direction,
    nodes: [...nodes.values()],
    groups: [...groups.values()],
    edges,
    notes
  };
}
