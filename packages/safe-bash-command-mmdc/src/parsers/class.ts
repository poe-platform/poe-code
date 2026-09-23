import {
  MermaidError,
  type CompartmentMember,
  type DocumentEdge,
  type DocumentGroup,
  type DocumentNode,
  type DocumentNote,
  type EdgeLineStyle,
  type EdgeMarkerKind,
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

interface MutableClassState {
  readonly id: string;
  label: string;
  groupId?: string | undefined;
  stereotype?: string | undefined;
  readonly attributes: CompartmentMember[];
  readonly methods: CompartmentMember[];
  span?: MermaidSourceSpan | undefined;
}

const CLASS_OPERATORS: readonly {
  readonly token: string;
  readonly startMarker: EdgeMarkerKind;
  readonly endMarker: EdgeMarkerKind;
  readonly lineStyle: EdgeLineStyle;
}[] = [
  { token: "<|--", startMarker: "umlHollowTriangle", endMarker: "none", lineStyle: "solid" },
  { token: "--|>", startMarker: "none", endMarker: "umlHollowTriangle", lineStyle: "solid" },
  { token: "<|..", startMarker: "umlHollowTriangle", endMarker: "none", lineStyle: "dotted" },
  { token: "..|>", startMarker: "none", endMarker: "umlHollowTriangle", lineStyle: "dotted" },
  { token: "*--", startMarker: "umlComposition", endMarker: "none", lineStyle: "solid" },
  { token: "--*", startMarker: "none", endMarker: "umlComposition", lineStyle: "solid" },
  { token: "o--", startMarker: "umlAggregation", endMarker: "none", lineStyle: "solid" },
  { token: "--o", startMarker: "none", endMarker: "umlAggregation", lineStyle: "solid" },
  { token: "<--", startMarker: "arrow", endMarker: "none", lineStyle: "solid" },
  { token: "-->", startMarker: "none", endMarker: "arrow", lineStyle: "solid" },
  { token: "<..", startMarker: "arrow", endMarker: "none", lineStyle: "dotted" },
  { token: "..>", startMarker: "none", endMarker: "arrow", lineStyle: "dotted" },
  { token: "--", startMarker: "none", endMarker: "none", lineStyle: "solid" },
  { token: "..", startMarker: "none", endMarker: "none", lineStyle: "dotted" }
];

function parseSterotypeToken(raw: string): string | null {
  const trimmed = trimWhitespace(raw);
  if (trimmed.startsWith("<<") && trimmed.endsWith(">>") && trimmed.length > 4) {
    return trimWhitespace(trimmed.slice(2, -2));
  }
  return null;
}

function parseClassMember(
  rawLine: string,
  budget: MermaidBudget,
  span: MermaidSourceSpan
): { stereotype?: string; member?: CompartmentMember } {
  const line = trimWhitespace(rawLine);
  const stereo = parseSterotypeToken(line);
  if (stereo !== null) {
    return { stereotype: checkSafeLabelText(stereo, budget, span) };
  }

  let visibility: "+" | "-" | "#" | "~" | undefined;
  let rest = line;
  if (
    rest.startsWith("+") ||
    rest.startsWith("-") ||
    rest.startsWith("#") ||
    rest.startsWith("~")
  ) {
    visibility = rest[0] as "+" | "-" | "#" | "~";
    rest = trimWhitespace(rest.slice(1));
  }

  const openParen = rest.indexOf("(");
  const closeParen = openParen >= 0 ? rest.lastIndexOf(")") : -1;

  if (openParen >= 0 && closeParen > openParen) {
    const methodSig = trimWhitespace(rest.slice(0, closeParen + 1));
    let retRaw = trimWhitespace(rest.slice(closeParen + 1));
    if (retRaw.startsWith(":")) {
      retRaw = trimWhitespace(retRaw.slice(1));
    }
    checkSafeLabelText(methodSig, budget, span);
    if (retRaw) checkSafeLabelText(retRaw, budget, span);
    return {
      member: {
        visibility,
        name: methodSig,
        typeOrReturn: retRaw || undefined,
        isMethod: true
      }
    };
  }

  // Attribute: either "name : type" or "type name"
  const colonIdx = rest.indexOf(":");
  if (colonIdx > 0) {
    const attrName = checkSafeLabelText(trimWhitespace(rest.slice(0, colonIdx)), budget, span);
    const attrType = checkSafeLabelText(trimWhitespace(rest.slice(colonIdx + 1)), budget, span);
    return {
      member: {
        visibility,
        name: attrName,
        typeOrReturn: attrType || undefined,
        isMethod: false
      }
    };
  }

  // Space-separated "type name"
  const parts = rest.split(" ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const attrType = checkSafeLabelText(parts.slice(0, -1).join(" "), budget, span);
    const attrName = checkSafeLabelText(parts[parts.length - 1]!, budget, span);
    return {
      member: {
        visibility,
        name: attrName,
        typeOrReturn: attrType,
        isMethod: false
      }
    };
  }

  return {
    member: {
      visibility,
      name: checkSafeLabelText(rest, budget, span),
      isMethod: false
    }
  };
}

function splitEndpointAndMultiplicity(
  rawSide: string,
  side: "left" | "right"
): { classId: string; multiplicity?: string } {
  const trimmed = trimWhitespace(rawSide);
  if (side === "left") {
    // e.g. Customer "1"
    if (trimmed.endsWith('"') || trimmed.endsWith("'")) {
      const qChar = trimmed[trimmed.length - 1]!;
      const openIdx = trimmed.lastIndexOf(qChar, trimmed.length - 2);
      if (openIdx > 0) {
        return {
          classId: stripQuotes(trimWhitespace(trimmed.slice(0, openIdx))),
          multiplicity: stripQuotes(trimmed.slice(openIdx))
        };
      }
    }
    return { classId: stripQuotes(trimmed) };
  } else {
    // e.g. "0..*" Order
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      const qChar = trimmed[0]!;
      const closeIdx = trimmed.indexOf(qChar, 1);
      if (closeIdx > 0 && closeIdx < trimmed.length - 1) {
        return {
          multiplicity: stripQuotes(trimmed.slice(0, closeIdx + 1)),
          classId: stripQuotes(trimWhitespace(trimmed.slice(closeIdx + 1)))
        };
      }
    }
    return { classId: stripQuotes(trimmed) };
  }
}

function findClassRelation(text: string): {
  leftRaw: string;
  rightRaw: string;
  labelRaw?: string;
  op: (typeof CLASS_OPERATORS)[number];
} | null {
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
    for (const op of CLASS_OPERATORS) {
      if (text.startsWith(op.token, i)) {
        const leftRaw = trimWhitespace(text.slice(0, i));
        const afterOp = trimWhitespace(text.slice(i + op.token.length));
        if (!leftRaw || !afterOp) continue;
        const colonIdx = indexOfChar(afterOp, ":");
        const rightRaw = colonIdx >= 0 ? trimWhitespace(afterOp.slice(0, colonIdx)) : afterOp;
        const labelRaw = colonIdx >= 0 ? trimWhitespace(afterOp.slice(colonIdx + 1)) : undefined;
        if (!rightRaw) continue;
        return { leftRaw, rightRaw, labelRaw, op };
      }
    }
  }
  return null;
}

export function parseClassDiagram(
  statements: readonly ScannedStatement[],
  budget: MermaidBudget
): MermaidDocument {
  let direction: FlowDirection = "TD";
  const classes = new Map<string, MutableClassState>();
  const groups = new Map<string, DocumentGroup>();
  const edges: DocumentEdge[] = [];
  const notes: DocumentNote[] = [];

  let activeNamespaceId: string | undefined;
  let activeClassId: string | undefined;

  const ensureClass = (
    rawId: string,
    explicitLabel?: string,
    span?: MermaidSourceSpan
  ): MutableClassState => {
    let id = stripQuotes(trimWhitespace(rawId));
    let label = explicitLabel;
    // Check for ClassId["Display Label"]
    const bracketStart = id.indexOf("[");
    if (bracketStart > 0 && id.endsWith("]")) {
      label = stripQuotes(id.slice(bracketStart + 1, -1));
      id = trimWhitespace(id.slice(0, bracketStart));
    }
    if (!id) {
      throw new MermaidError("E_SYNTAX", "Missing class identifier in classDiagram", { span });
    }
    const display = label !== undefined ? checkSafeLabelText(label, budget, span) : id;
    let entry = classes.get(id);
    if (!entry) {
      budget.chargeNodes(1);
      entry = {
        id,
        label: display,
        groupId: activeNamespaceId,
        attributes: [],
        methods: [],
        span
      };
      classes.set(id, entry);
    } else {
      if (label !== undefined) entry.label = display;
      if (activeNamespaceId && !entry.groupId) entry.groupId = activeNamespaceId;
    }
    return entry;
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

    if (text === "}") {
      if (activeClassId !== undefined) {
        activeClassId = undefined;
      } else if (activeNamespaceId !== undefined) {
        activeNamespaceId = undefined;
      } else {
        throw new MermaidError("E_SYNTAX", "Unexpected '}' in classDiagram", { span });
      }
      continue;
    }

    if (activeClassId !== undefined) {
      const targetClass = classes.get(activeClassId)!;
      const parsed = parseClassMember(text, budget, span);
      if (parsed.stereotype) {
        targetClass.stereotype = parsed.stereotype;
      } else if (parsed.member) {
        if (parsed.member.isMethod) targetClass.methods.push(parsed.member);
        else targetClass.attributes.push(parsed.member);
      }
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
      throw new MermaidError("E_SYNTAX", `Invalid classDiagram direction '${dirRaw}'`, { span });
    }

    if (lowerKw === "namespace") {
      let nsRest = trimWhitespace(text.slice(afterKw));
      if (!nsRest.endsWith("{")) {
        throw new MermaidError("E_SYNTAX", "Expected '{' at end of 'namespace' declaration", {
          span
        });
      }
      nsRest = stripQuotes(trimWhitespace(nsRest.slice(0, -1)));
      if (!nsRest) {
        throw new MermaidError("E_SYNTAX", "Missing namespace identifier", { span });
      }
      checkSafeLabelText(nsRest, budget, span);
      groups.set(nsRest, {
        id: nsRest,
        label: nsRest,
        kind: "namespace",
        span
      });
      activeNamespaceId = nsRest;
      budget.enterDepth(1);
      continue;
    }

    if (lowerKw === "class") {
      let classRest = trimWhitespace(text.slice(afterKw));
      let opensBlock = false;
      if (classRest.endsWith("{")) {
        opensBlock = true;
        classRest = trimWhitespace(classRest.slice(0, -1));
      }
      // Check for inline <<stereotype>> on class line
      let inlineStereo: string | undefined;
      const stereoStart = classRest.indexOf("<<");
      const stereoEnd = stereoStart >= 0 ? classRest.indexOf(">>", stereoStart + 2) : -1;
      if (stereoStart > 0 && stereoEnd > stereoStart) {
        inlineStereo = checkSafeLabelText(
          trimWhitespace(classRest.slice(stereoStart + 2, stereoEnd)),
          budget,
          span
        );
        classRest = trimWhitespace(
          classRest.slice(0, stereoStart) + " " + classRest.slice(stereoEnd + 2)
        );
      }

      const cls = ensureClass(classRest, undefined, span);
      if (inlineStereo) cls.stereotype = inlineStereo;
      if (opensBlock) {
        activeClassId = cls.id;
        budget.enterDepth(activeNamespaceId ? 2 : 1);
      }
      continue;
    }

    // Check for relationship line
    const rel = findClassRelation(text);
    if (rel !== null) {
      const leftSide = splitEndpointAndMultiplicity(rel.leftRaw, "left");
      const rightSide = splitEndpointAndMultiplicity(rel.rightRaw, "right");
      const leftCls = ensureClass(leftSide.classId, undefined, span);
      const rightCls = ensureClass(rightSide.classId, undefined, span);
      const label =
        rel.labelRaw !== undefined
          ? checkSafeLabelText(stripQuotes(rel.labelRaw), budget, span)
          : undefined;
      if (leftSide.multiplicity) checkSafeLabelText(leftSide.multiplicity, budget, span);
      if (rightSide.multiplicity) checkSafeLabelText(rightSide.multiplicity, budget, span);

      budget.chargeEdges(1);
      edges.push({
        id: `class_edge_${edges.length + 1}`,
        from: leftCls.id,
        to: rightCls.id,
        label: label || undefined,
        sourceLabel: leftSide.multiplicity,
        targetLabel: rightSide.multiplicity,
        lineStyle: rel.op.lineStyle,
        startMarker: rel.op.startMarker,
        endMarker: rel.op.endMarker,
        span
      });
      continue;
    }

    // Check for "ClassName : member"
    const colonIdx = indexOfChar(text, ":");
    if (colonIdx > 0) {
      const classId = stripQuotes(trimWhitespace(text.slice(0, colonIdx)));
      const memberRaw = trimWhitespace(text.slice(colonIdx + 1));
      const cls = ensureClass(classId, undefined, span);
      const parsed = parseClassMember(memberRaw, budget, span);
      if (parsed.stereotype) {
        cls.stereotype = parsed.stereotype;
      } else if (parsed.member) {
        if (parsed.member.isMethod) cls.methods.push(parsed.member);
        else cls.attributes.push(parsed.member);
      }
      continue;
    }

    throw new MermaidError("E_SYNTAX", `Unrecognized classDiagram statement: '${text}'`, {
      span
    });
  }

  if (activeClassId !== undefined) {
    throw new MermaidError("E_SYNTAX", `Unclosed class block '${activeClassId}'`, {
      span: classes.get(activeClassId)?.span
    });
  }
  if (activeNamespaceId !== undefined) {
    throw new MermaidError("E_SYNTAX", `Unclosed namespace block '${activeNamespaceId}'`, {
      span: groups.get(activeNamespaceId)?.span
    });
  }

  const docNodes: DocumentNode[] = Array.from(classes.values()).map((c) => ({
    id: c.id,
    label: c.label,
    shape: "classCard",
    groupId: c.groupId,
    stereotype: c.stereotype,
    attributes: c.attributes,
    methods: c.methods,
    span: c.span
  }));

  return {
    family: "class",
    direction,
    nodes: docNodes,
    groups: Array.from(groups.values()),
    edges,
    notes
  };
}
