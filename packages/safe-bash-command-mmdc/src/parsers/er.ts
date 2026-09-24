import {
  MermaidError,
  type CompartmentMember,
  type DocumentEdge,
  type DocumentNode,
  type EdgeLineStyle,
  type EdgeMarkerKind,
  type FlowDirection,
  type MermaidBudget,
  type MermaidDocument,
  type MermaidSourceSpan
} from "../contracts.js";
import { stripQuotes } from "../parser-utils.js";
import { checkSafeLabelText, type ScannedStatement } from "../scanner.js";

interface MutableErEntity {
  readonly id: string;
  label: string;
  readonly attributes: CompartmentMember[];
  span?: MermaidSourceSpan | undefined;
}

function parseEntityToken(
  raw: string,
  budget: MermaidBudget,
  span: MermaidSourceSpan
): { readonly id: string; readonly label: string } {
  const trimmed = raw.trim();
  const aliasMatch = /^([A-Za-z0-9_-]+|"[^"]+")\s*\[\s*"([^"]+)"\s*\]$/.exec(trimmed);
  if (aliasMatch) {
    const id = stripQuotes(aliasMatch[1]!);
    const label = checkSafeLabelText(aliasMatch[2]!, budget, span);
    return { id, label };
  }
  const clean = checkSafeLabelText(stripQuotes(trimmed), budget, span);
  return { id: clean, label: clean };
}

function parseCardinalityToken(token: string, span: MermaidSourceSpan): EdgeMarkerKind {
  switch (token) {
    case "||":
      return "erExactlyOne";
    case "|o":
    case "o|":
      return "erZeroOrOne";
    case "}|":
    case "|{":
      return "erOneOrMore";
    case "}o":
    case "o{":
      return "erZeroOrMore";
    default:
      throw new MermaidError("E_SYNTAX", `Unsupported ER cardinality token '${token}'`, {
        span
      });
  }
}

function parseAttributeLine(raw: string, stmt: ScannedStatement): CompartmentMember {
  let working = raw.trim();
  const quoteIdx = working.indexOf('"');
  if (quoteIdx >= 0) {
    working = working.slice(0, quoteIdx).trim();
  }
  const tokens = working.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    throw new MermaidError("E_SYNTAX", `Invalid ER attribute declaration '${raw}'`, {
      span: {
        offset: stmt.offset,
        line: stmt.line,
        column: stmt.column,
        length: stmt.text.length
      }
    });
  }
  const attrType = tokens[0]!;
  const attrName = tokens[1]!;
  let badge: "PK" | "FK" | "UK" | undefined;
  for (const extra of tokens.slice(2)) {
    const parts = extra.split(",").map((p) => p.trim().toUpperCase());
    for (const part of parts) {
      if (part === "PK" || part === "FK" || part === "UK") {
        badge = part;
        break;
      }
    }
    if (badge) break;
  }
  return {
    name: attrName,
    typeOrReturn: attrType,
    isMethod: false,
    badge
  };
}

export function parseErDiagram(
  statements: readonly ScannedStatement[],
  budget: MermaidBudget
): MermaidDocument {
  let direction: FlowDirection = "TB";
  const entities = new Map<string, MutableErEntity>();
  const edges: DocumentEdge[] = [];

  const ensureEntity = (
    id: string,
    label: string | undefined,
    span: MermaidSourceSpan
  ): MutableErEntity => {
    let existing = entities.get(id);
    if (!existing) {
      budget.chargeNodes(1);
      existing = {
        id,
        label: label ?? id,
        attributes: [],
        span
      };
      entities.set(id, existing);
    } else if (label && existing.label === existing.id && label !== id) {
      existing.label = label;
    }
    return existing;
  };

  let activeEntity: MutableErEntity | undefined;

  for (let i = 1; i < statements.length; i++) {
    const stmt = statements[i]!;
    const text = stmt.text.trim();
    const span: MermaidSourceSpan = {
      offset: stmt.offset,
      line: stmt.line,
      column: stmt.column,
      length: stmt.text.length
    };

    if (activeEntity) {
      if (text === "}") {
        activeEntity = undefined;
        continue;
      }
      activeEntity.attributes.push(parseAttributeLine(text, stmt));
      continue;
    }

    const dirMatch = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text);
    if (dirMatch) {
      const dir = dirMatch[1]!.toUpperCase();
      direction = (dir === "TD" ? "TB" : dir) as FlowDirection;
      continue;
    }

    // Empty single-line entity block: ENTITY { }
    const emptyBlockMatch = /^(.+?)\s*\{\s*\}\s*$/.exec(text);
    if (emptyBlockMatch) {
      const parsed = parseEntityToken(emptyBlockMatch[1]!, budget, span);
      ensureEntity(parsed.id, parsed.label, span);
      continue;
    }

    // Entity block opening: ENTITY {
    const blockOpenMatch = /^(.+?)\s*\{\s*$/.exec(text);
    if (blockOpenMatch) {
      const parsed = parseEntityToken(blockOpenMatch[1]!, budget, span);
      activeEntity = ensureEntity(parsed.id, parsed.label, span);
      continue;
    }

    // Relationship statement:
    // <EntityA> <leftCard><-- or ..><rightCard> <EntityB> [: <label>]
    const relMatch =
      /^("[^"]+"|[A-Za-z0-9_-]+)\s+(\|\||\|o|o\||\}\||\|\{|\}o|o\{)(--|\.\.)(\|\||\|o|o\||\}\||\|\{|\}o|o\{)\s+("[^"]+"|[A-Za-z0-9_-]+)(?:\s*:\s*(.+))?$/.exec(
        text
      );
    if (relMatch) {
      const leftEntity = parseEntityToken(relMatch[1]!, budget, span);
      const leftCard = parseCardinalityToken(relMatch[2]!, span);
      const lineStyle: EdgeLineStyle = relMatch[3] === ".." ? "dotted" : "solid";
      const rightCard = parseCardinalityToken(relMatch[4]!, span);
      const rightEntity = parseEntityToken(relMatch[5]!, budget, span);
      const rawLabel = relMatch[6]?.trim();
      const label =
        rawLabel && rawLabel.length > 0
          ? checkSafeLabelText(stripQuotes(rawLabel), budget, span)
          : undefined;

      ensureEntity(leftEntity.id, leftEntity.label, span);
      ensureEntity(rightEntity.id, rightEntity.label, span);

      budget.chargeEdges(1);
      edges.push({
        id: `e_${edges.length}`,
        from: leftEntity.id,
        to: rightEntity.id,
        label,
        lineStyle,
        startMarker: leftCard,
        endMarker: rightCard,
        span
      });
      continue;
    }

    // Standalone entity declaration
    const standaloneMatch = /^([A-Za-z0-9_-]+|"[^"]+")(?:\[\s*"([^"]+)"\s*\])?$/.exec(text);
    if (standaloneMatch) {
      const parsed = parseEntityToken(text, budget, span);
      ensureEntity(parsed.id, parsed.label, span);
      continue;
    }

    throw new MermaidError("E_SYNTAX", `Unrecognized erDiagram statement '${text}'`, {
      span
    });
  }

  if (activeEntity) {
    const last = statements[statements.length - 1]!;
    throw new MermaidError("E_SYNTAX", `Unclosed entity block '${activeEntity.id}'`, {
      span: {
        offset: last.offset,
        line: last.line,
        column: last.column,
        length: last.text.length
      }
    });
  }

  const nodes: DocumentNode[] = [...entities.values()].map((ent) => ({
    id: ent.id,
    label: ent.label,
    shape: "erEntity",
    attributes: ent.attributes,
    span: ent.span
  }));

  return {
    family: "er",
    direction,
    nodes,
    edges,
    groups: [],
    notes: [],
    participants: []
  };
}
