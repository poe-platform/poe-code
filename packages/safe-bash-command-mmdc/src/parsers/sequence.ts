import {
  MermaidError,
  type DocumentEdge,
  type DocumentGroup,
  type DocumentNode,
  type DocumentNote,
  type EdgeLineStyle,
  type EdgeMarkerKind,
  type MermaidBudget,
  type MermaidDocument,
  type MermaidSourceSpan,
  type SequenceActivationEvent
} from "../contracts.js";
import {
  indexOfChar,
  readWord,
  skipSpaces,
  stripQuotes,
  trimWhitespace
} from "../parser-utils.js";
import type { ScannedStatement } from "../scanner.js";

const encoder = new TextEncoder();

interface OpenSequenceBlock {
  readonly id: string;
  readonly keyword: "loop" | "alt" | "opt";
  readonly label: string;
  readonly parentId?: string | undefined;
  readonly branches: { label: string; messageIndices: number[] }[];
  readonly span: MermaidSourceSpan;
}

interface ParsedArrowToken {
  readonly arrowEnd: number;
  readonly lineStyle: EdgeLineStyle;
  readonly endMarker: EdgeMarkerKind;
  readonly activateTarget: boolean;
  readonly deactivateSource: boolean;
}

function findSequenceArrow(text: string): {
  readonly fromRaw: string;
  readonly toRaw: string;
  readonly messageText: string;
  readonly arrow: ParsedArrowToken;
} | null {
  // Scan character by character outside quotes for sequence arrow operators:
  // -->>, ->>, -->, ->, --x, -x
  // A single -x can also be part of a participant ID. Keep it as a
  // fallback until a later, unambiguous arrow resolves that boundary.
  let crossCandidate: ReturnType<typeof findSequenceArrow> = null;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":") break;
    if (ch !== "-") continue;

    let arrowLen = 0;
    let lineStyle: EdgeLineStyle = "solid";
    let endMarker: EdgeMarkerKind = "arrow";

    if (text.startsWith("-->>", i)) {
      arrowLen = 4;
      lineStyle = "dotted";
      endMarker = "arrow";
    } else if (text.startsWith("->>", i)) {
      arrowLen = 3;
      lineStyle = "solid";
      endMarker = "arrow";
    } else if (text.startsWith("-->", i)) {
      arrowLen = 3;
      lineStyle = "dotted";
      endMarker = "openArrow";
    } else if (text.startsWith("->", i)) {
      arrowLen = 2;
      lineStyle = "solid";
      endMarker = "openArrow";
    } else if (text.startsWith("--x", i) || text.startsWith("--X", i)) {
      arrowLen = 3;
      lineStyle = "dotted";
      endMarker = "cross";
    } else if (text.startsWith("-x", i) || text.startsWith("-X", i)) {
      arrowLen = 2;
      lineStyle = "solid";
      endMarker = "cross";
    }

    if (arrowLen === 0) continue;

    let cursor = i + arrowLen;
    let activateTarget = false;
    let deactivateSource = false;
    if (text[cursor] === "+") {
      activateTarget = true;
      cursor++;
    } else if (text[cursor] === "-") {
      deactivateSource = true;
      cursor++;
    }

    const fromRaw = trimWhitespace(text.slice(0, i));
    if (!fromRaw) continue;

    const rest = text.slice(cursor);
    const colonIdx = indexOfChar(rest, ":");
    const toRaw = trimWhitespace(colonIdx >= 0 ? rest.slice(0, colonIdx) : rest);
    if (!toRaw) continue;
    const messageText = colonIdx >= 0 ? trimWhitespace(rest.slice(colonIdx + 1)) : "";

    const candidate = {
      fromRaw,
      toRaw,
      messageText,
      arrow: {
        arrowEnd: cursor,
        lineStyle,
        endMarker,
        activateTarget,
        deactivateSource
      }
    };
    if (endMarker === "cross" && arrowLen === 2) {
      crossCandidate ??= candidate;
      continue;
    }
    return candidate;
  }
  return crossCandidate;
}

export function parseSequenceDiagram(
  statements: readonly ScannedStatement[],
  budget: MermaidBudget
): MermaidDocument {
  const nodes = new Map<string, DocumentNode>();
  const groups: DocumentGroup[] = [];
  const edges: DocumentEdge[] = [];
  const notes: DocumentNote[] = [];
  const activations: SequenceActivationEvent[] = [];
  const blockStack: OpenSequenceBlock[] = [];

  let sequenceIndex = 0;

  const ensureParticipant = (
    rawId: string,
    explicitLabel?: string,
    isActor = false,
    span?: MermaidSourceSpan
  ): string => {
    const id = stripQuotes(trimWhitespace(rawId));
    if (!id) {
      throw new MermaidError("E_SYNTAX", "Missing participant identifier in sequenceDiagram", {
        span
      });
    }
    const label = explicitLabel !== undefined ? stripQuotes(trimWhitespace(explicitLabel)) : id;
    budget.checkLabelBytes(encoder.encode(label).byteLength, span);

    const existing = nodes.get(id);
    if (!existing) {
      budget.chargeNodes(1);
      nodes.set(id, {
        id,
        label,
        shape: "participant",
        stereotype: isActor ? "actor" : undefined,
        span
      });
    } else if (explicitLabel !== undefined || isActor) {
      nodes.set(id, {
        ...existing,
        label: explicitLabel !== undefined ? label : existing.label,
        stereotype: isActor ? "actor" : existing.stereotype
      });
    }
    return id;
  };

  const recordStepInBlocks = (stepIdx: number): void => {
    for (const block of blockStack) {
      const currentBranch = block.branches[block.branches.length - 1]!;
      currentBranch.messageIndices.push(stepIdx);
    }
  };

  for (let sIdx = 1; sIdx < statements.length; sIdx++) {
    const stmt = statements[sIdx]!;
    const text = stmt.text;
    const span: MermaidSourceSpan = {
      offset: stmt.offset,
      line: stmt.line,
      column: stmt.column,
      length: text.length
    };
    const { word: kw, next: afterKw } = readWord(text, 0);
    const lowerKw = kw.toLowerCase();

    if (lowerKw === "link" || lowerKw === "links" || lowerKw === "click") {
      throw new MermaidError(
        "E_UNSUPPORTED",
        `Interactive sequence directive '${kw}' is not supported`,
        { span }
      );
    }

    if (lowerKw === "autonumber") {
      continue;
    }

    if (lowerKw === "participant" || lowerKw === "actor") {
      const rest = trimWhitespace(text.slice(afterKw));
      // Check for " as " keyword outside quotes
      let asIndex = -1;
      let q: string | null = null;
      for (let i = 0; i <= rest.length - 4; i++) {
        const c = rest[i]!;
        if (q !== null) {
          if (c === q && rest[i - 1] !== "\\") q = null;
          continue;
        }
        if (c === '"' || c === "'") {
          q = c;
          continue;
        }
        if (
          (c === " " || c === "\t") &&
          rest.slice(i + 1, i + 3).toLowerCase() === "as" &&
          (rest[i + 3] === " " || rest[i + 3] === "\t")
        ) {
          asIndex = i;
          break;
        }
      }

      if (asIndex >= 0) {
        const idPart = trimWhitespace(rest.slice(0, asIndex));
        const labelPart = trimWhitespace(rest.slice(asIndex + 4));
        ensureParticipant(idPart, labelPart, lowerKw === "actor", span);
      } else {
        ensureParticipant(rest, undefined, lowerKw === "actor", span);
      }
      continue;
    }

    if (lowerKw === "activate" || lowerKw === "deactivate") {
      const targetRaw = trimWhitespace(text.slice(afterKw));
      const participantId = ensureParticipant(targetRaw, undefined, false, span);
      activations.push({
        participantId,
        action: lowerKw as "activate" | "deactivate",
        sequenceIndex: Math.max(0, sequenceIndex - 1),
        span
      });
      continue;
    }

    if (lowerKw === "note") {
      const rest = trimWhitespace(text.slice(afterKw));
      const colonIdx = indexOfChar(rest, ":");
      if (colonIdx < 0) {
        throw new MermaidError("E_SYNTAX", "Sequence 'Note' requires ': <text>'", { span });
      }
      const headerPart = trimWhitespace(rest.slice(0, colonIdx));
      const noteText = stripQuotes(trimWhitespace(rest.slice(colonIdx + 1)));
      budget.checkLabelBytes(encoder.encode(noteText).byteLength, span);

      const lowerHeader = headerPart.toLowerCase();
      let position: "left" | "right" | "over";
      let targetsRaw: string;

      if (lowerHeader.startsWith("left of ")) {
        position = "left";
        targetsRaw = trimWhitespace(headerPart.slice("left of ".length));
      } else if (lowerHeader.startsWith("right of ")) {
        position = "right";
        targetsRaw = trimWhitespace(headerPart.slice("right of ".length));
      } else if (lowerHeader.startsWith("over ")) {
        position = "over";
        targetsRaw = trimWhitespace(headerPart.slice("over ".length));
      } else {
        throw new MermaidError(
          "E_SYNTAX",
          `Invalid sequence Note placement '${headerPart}' (expected 'left of', 'right of', or 'over')`,
          { span }
        );
      }

      const targetIds = targetsRaw
        .split(",")
        .map((t) => ensureParticipant(t, undefined, false, span));

      const stepIdx = sequenceIndex++;
      recordStepInBlocks(stepIdx);
      notes.push({
        id: `note_${notes.length + 1}`,
        text: noteText,
        targetIds,
        position,
        sequenceIndex: stepIdx,
        span
      });
      continue;
    }

    if (lowerKw === "loop" || lowerKw === "alt" || lowerKw === "opt") {
      const label = stripQuotes(trimWhitespace(text.slice(afterKw)));
      budget.checkLabelBytes(encoder.encode(label).byteLength, span);
      const parentId = blockStack.length > 0 ? blockStack[blockStack.length - 1]!.id : undefined;
      const blockId = `seq_block_${groups.length + blockStack.length + 1}`;
      blockStack.push({
        id: blockId,
        keyword: lowerKw as "loop" | "alt" | "opt",
        label,
        parentId,
        branches: [{ label, messageIndices: [] }],
        span
      });
      budget.enterDepth(blockStack.length);
      continue;
    }

    if (lowerKw === "else") {
      const current = blockStack[blockStack.length - 1];
      if (!current || current.keyword !== "alt") {
        throw new MermaidError("E_SYNTAX", "'else' is only valid inside an 'alt' sequence block", {
          span
        });
      }
      const branchLabel = stripQuotes(trimWhitespace(text.slice(afterKw))) || "else";
      budget.checkLabelBytes(encoder.encode(branchLabel).byteLength, span);
      current.branches.push({ label: branchLabel, messageIndices: [] });
      continue;
    }

    if (lowerKw === "end") {
      const closed = blockStack.pop();
      if (!closed) {
        throw new MermaidError("E_SYNTAX", "Unexpected 'end' without matching sequence block", {
          span
        });
      }
      groups.push({
        id: closed.id,
        label: closed.label,
        parentId: closed.parentId,
        kind: "sequenceBlock",
        blockKeyword: closed.keyword,
        branches: closed.branches,
        span: closed.span
      });
      continue;
    }

    // Otherwise parse as sequence message
    const msg = findSequenceArrow(text);
    if (!msg) {
      throw new MermaidError("E_SYNTAX", `Unrecognized sequenceDiagram statement: '${text}'`, {
        span
      });
    }

    const fromId = ensureParticipant(msg.fromRaw, undefined, false, span);
    const toId = ensureParticipant(msg.toRaw, undefined, false, span);
    const label = stripQuotes(msg.messageText);
    budget.checkLabelBytes(encoder.encode(label).byteLength, span);
    budget.chargeEdges(1);

    const stepIdx = sequenceIndex++;
    recordStepInBlocks(stepIdx);

    if (msg.arrow.activateTarget) {
      activations.push({
        participantId: toId,
        action: "activate",
        sequenceIndex: stepIdx,
        span
      });
    }
    if (msg.arrow.deactivateSource) {
      activations.push({
        participantId: fromId,
        action: "deactivate",
        sequenceIndex: stepIdx,
        span
      });
    }

    edges.push({
      id: `seq_msg_${edges.length + 1}`,
      from: fromId,
      to: toId,
      label: label || undefined,
      lineStyle: msg.arrow.lineStyle,
      startMarker: "none",
      endMarker: msg.arrow.endMarker,
      activateTarget: msg.arrow.activateTarget || undefined,
      deactivateSource: msg.arrow.deactivateSource || undefined,
      sequenceIndex: stepIdx,
      span
    });
  }

  if (blockStack.length > 0) {
    const unclosed = blockStack[blockStack.length - 1]!;
    throw new MermaidError(
      "E_SYNTAX",
      `Unclosed sequence block '${unclosed.keyword}'`,
      { span: unclosed.span }
    );
  }

  return {
    family: "sequence",
    direction: "TD",
    nodes: Array.from(nodes.values()),
    groups,
    edges,
    notes,
    activations
  };
}
