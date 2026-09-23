import {
  admitMermaidLimits,
  MermaidBudget,
  MermaidError,
  type DocumentGroup,
  type DocumentNode,
  type MermaidDocument,
  type MermaidLayoutOptions,
  type MermaidScene,
  type MermaidThemeTokens,
  type PathSegment,
  type Point,
  type SceneBadge,
  type SceneDivider,
  type SceneEdge,
  type SceneGroup,
  type SceneLabelPill,
  type SceneNote,
  type SceneNode,
  type SceneTextLine
} from "../contracts.js";
import { rectsIntersect, snapTo8 } from "../geometry.js";
import { measureLineWidth, measureTextBlock } from "../text.js";
import { resolveMermaidTheme } from "../theme.js";
import { routeGraphEdges } from "./routing.js";

interface SizedNode {
  readonly doc: DocumentNode;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly headerHeight?: number | undefined;
}

function measureNodeBox(node: DocumentNode, theme: MermaidThemeTokens): SizedNode {
  if (node.shape === "stateStart" || node.shape === "stateEnd") {
    return { doc: node, width: 28, height: 28, rx: 14 };
  }

  if (node.shape === "classCard" || node.shape === "erEntity") {
    const titleMeasure = measureTextBlock(node.label, {
      fontSize: theme.fontSize,
      lineHeight: theme.lineHeight,
      fontFamily: "ui",
      fontWeight: 600
    });
    const stereoWidth = node.stereotype
      ? measureLineWidth(`«${node.stereotype}»`, theme.secondaryFontSize, "ui", 500)
      : 0;
    const headerHeight = node.stereotype
      ? Math.max(46, titleMeasure.height + 24)
      : Math.max(36, titleMeasure.height + 16);

    let maxRowWidth = Math.max(titleMeasure.width, stereoWidth) + 36;
    const attrs = node.attributes ?? [];
    const methods = node.methods ?? [];

    for (const member of [...attrs, ...methods]) {
      const leftText = `${member.visibility ?? ""}${member.name}${member.isMethod ? "()" : ""}`;
      const leftW = measureLineWidth(leftText, theme.secondaryFontSize, "ui", 500);
      const rightW = member.typeOrReturn
        ? measureLineWidth(member.typeOrReturn, theme.secondaryFontSize, "mono", 400) + 16
        : 0;
      const badgeW = member.badge ? 34 : 0;
      const rowW = leftW + rightW + badgeW + 40;
      if (rowW > maxRowWidth) maxRowWidth = rowW;
    }

    const attrHeight = attrs.length > 0 ? attrs.length * 22 + 12 : 0;
    const methodHeight =
      node.shape === "classCard" && methods.length > 0 ? methods.length * 22 + 12 : 0;
    const totalHeight = Math.max(
      48,
      snapTo8(headerHeight + (attrHeight || (node.shape === "erEntity" ? 12 : 0)) + methodHeight)
    );
    const totalWidth = Math.max(128, snapTo8(maxRowWidth));

    return {
      doc: node,
      width: totalWidth,
      height: totalHeight,
      rx: 8,
      headerHeight
    };
  }

  const measured = measureTextBlock(node.label, {
    fontSize: theme.fontSize,
    lineHeight: theme.lineHeight,
    fontFamily: "ui",
    fontWeight: 500
  });

  if (node.shape === "diamond") {
    const width = Math.max(120, snapTo8((measured.width + 36) * 1.68));
    const height = Math.max(72, snapTo8((measured.height + 22) * 1.68));
    return { doc: node, width, height, rx: 4 };
  }

  if (node.shape === "circle") {
    const diameter = Math.max(64, snapTo8(Math.hypot(measured.width + 28, measured.height + 24)));
    return { doc: node, width: diameter, height: diameter, rx: Math.round(diameter / 2) };
  }

  const width = Math.max(88, snapTo8(measured.width + 36));
  const height = Math.max(40, snapTo8(measured.height + 22));
  const rx =
    node.shape === "stadium"
      ? Math.round(height / 2)
      : node.shape === "rounded"
        ? 12
        : theme.cornerRadius;

  return { doc: node, width, height, rx };
}

function buildSceneNode(
  sized: SizedNode,
  x: number,
  y: number,
  theme: MermaidThemeTokens
): SceneNode {
  const { doc, width, height, rx, headerHeight } = sized;
  const isAccent =
    doc.accent === true ||
    doc.shape === "diamond" ||
    doc.shape === "stadium" ||
    doc.shape === "circle";

  const fill =
    doc.shape === "stateStart"
      ? theme.accent
      : doc.shape === "stateEnd"
        ? theme.surface
        : isAccent
          ? theme.surfaceAccent
          : theme.surface;
  const stroke =
    doc.shape === "stateStart" || doc.shape === "stateEnd" || isAccent
      ? theme.accentBorder
      : theme.border;

  if (doc.shape === "stateStart" || doc.shape === "stateEnd") {
    return {
      id: doc.id,
      shape: doc.shape,
      x,
      y,
      width,
      height,
      rx,
      fill,
      stroke,
      strokeWidth: 1.5,
      shadow: false,
      groupId: doc.groupId,
      lines: [],
      dividers: [],
      badges: []
    };
  }

  if (doc.shape === "classCard" || doc.shape === "erEntity") {
    const hHeight = headerHeight ?? 36;
    const lines: SceneTextLine[] = [];
    const dividers: SceneDivider[] = [];
    const badges: SceneBadge[] = [];

    let titleY = y + hHeight / 2 + 4.5;
    if (doc.stereotype) {
      const stText = `«${doc.stereotype}»`;
      lines.push({
        text: stText,
        width: measureLineWidth(stText, theme.secondaryFontSize, "ui", 500),
        x: Math.round(x + width / 2),
        y: Math.round(y + 15),
        fontSize: theme.secondaryFontSize,
        fontWeight: 500,
        fontFamily: "ui",
        color: theme.mutedText,
        align: "center"
      });
      titleY = y + 33;
    }

    lines.push({
      text: doc.label,
      width: measureLineWidth(doc.label, theme.fontSize, "ui", 600),
      x: Math.round(x + width / 2),
      y: Math.round(titleY),
      fontSize: theme.fontSize,
      fontWeight: 600,
      fontFamily: "ui",
      color: theme.text,
      align: "center"
    });

    let cursorY = y + hHeight;
    const attrs = doc.attributes ?? [];
    const methods = doc.methods ?? [];

    if (attrs.length > 0 || methods.length > 0) {
      dividers.push({
        x1: x,
        y1: cursorY,
        x2: x + width,
        y2: cursorY,
        stroke: theme.border
      });
    }

    if (attrs.length > 0) {
      cursorY += 6;
      for (const attr of attrs) {
        const rowY = cursorY + 15;
        const leftLabel = `${attr.visibility ?? ""}${attr.name}`;
        lines.push({
          text: leftLabel,
          width: measureLineWidth(leftLabel, theme.secondaryFontSize, "ui", 500),
          x: x + 14,
          y: rowY,
          fontSize: theme.secondaryFontSize,
          fontWeight: 500,
          fontFamily: "ui",
          color: theme.text,
          align: "left"
        });

        let rightEdge = x + width - 14;
        if (attr.badge) {
          const bw = 26;
          const bh = 15;
          const bx = rightEdge - bw;
          const by = cursorY + 3;
          badges.push({
            x: bx,
            y: by,
            width: bw,
            height: bh,
            rx: 4,
            fill: theme.accentSurface,
            stroke: theme.accentBorder,
            text: {
              text: attr.badge,
              width: measureLineWidth(attr.badge, 9.5, "mono", 600),
              x: Math.round(bx + bw / 2),
              y: Math.round(by + 11),
              fontSize: 9.5,
              fontWeight: 600,
              fontFamily: "mono",
              color: theme.accent,
              align: "center"
            }
          });
          rightEdge = bx - 8;
        }

        if (attr.typeOrReturn) {
          lines.push({
            text: attr.typeOrReturn,
            width: measureLineWidth(attr.typeOrReturn, theme.secondaryFontSize, "mono", 400),
            x: rightEdge,
            y: rowY,
            fontSize: theme.secondaryFontSize,
            fontWeight: 400,
            fontFamily: "mono",
            color: theme.mutedText,
            align: "right"
          });
        }
        cursorY += 22;
      }
      cursorY += 6;
    }

    if (doc.shape === "classCard" && methods.length > 0) {
      dividers.push({
        x1: x,
        y1: cursorY,
        x2: x + width,
        y2: cursorY,
        stroke: theme.border
      });
      cursorY += 6;
      for (const method of methods) {
        const rowY = cursorY + 15;
        const leftLabel = `${method.visibility ?? ""}${method.name}${method.name.includes("(") ? "" : "()"}`;
        lines.push({
          text: leftLabel,
          width: measureLineWidth(leftLabel, theme.secondaryFontSize, "ui", 500),
          x: x + 14,
          y: rowY,
          fontSize: theme.secondaryFontSize,
          fontWeight: 500,
          fontFamily: "ui",
          color: theme.text,
          align: "left"
        });
        if (method.typeOrReturn) {
          lines.push({
            text: method.typeOrReturn,
            width: measureLineWidth(method.typeOrReturn, theme.secondaryFontSize, "mono", 400),
            x: x + width - 14,
            y: rowY,
            fontSize: theme.secondaryFontSize,
            fontWeight: 400,
            fontFamily: "mono",
            color: theme.mutedText,
            align: "right"
          });
        }
        cursorY += 22;
      }
    }

    return {
      id: doc.id,
      shape: doc.shape,
      x,
      y,
      width,
      height,
      rx,
      fill: theme.surface,
      headerFill: theme.groupHeaderSurface,
      headerHeight: hHeight,
      stroke: theme.border,
      strokeWidth: theme.strokeWidth,
      shadow: true,
      groupId: doc.groupId,
      lines,
      dividers,
      badges
    };
  }

  const measured = measureTextBlock(doc.label, {
    fontSize: theme.fontSize,
    lineHeight: theme.lineHeight,
    fontFamily: "ui",
    fontWeight: 500
  });
  const totalTextHeight = measured.lines.length * theme.lineHeight;
  const startY = y + (height - totalTextHeight) / 2 + theme.fontSize + 1;

  const lines: SceneTextLine[] = measured.lines.map((line, idx) => ({
    text: line.text,
    width: line.width,
    x: Math.round(x + width / 2),
    y: Math.round(startY + idx * theme.lineHeight),
    fontSize: theme.fontSize,
    fontWeight: 500,
    fontFamily: "ui",
    color: isAccent ? theme.accentText : theme.text,
    align: "center"
  }));

  return {
    id: doc.id,
    shape: doc.shape,
    x,
    y,
    width,
    height,
    rx,
    fill,
    stroke,
    strokeWidth: theme.strokeWidth,
    shadow: true,
    groupId: doc.groupId,
    lines,
    dividers: [],
    badges: []
  };
}

function getGroupAncestors(
  groupId: string | undefined,
  groupById: ReadonlyMap<string, DocumentGroup>
): readonly string[] {
  const chain: string[] = [];
  let current = groupId;
  while (current) {
    chain.push(current);
    current = groupById.get(current)?.parentId;
  }
  return chain;
}

function shiftEdge(edge: SceneEdge, dx: number, dy: number): SceneEdge {
  const shiftPt = (p: Point): Point => ({
    x: Math.round((p.x + dx) * 100) / 100,
    y: Math.round((p.y + dy) * 100) / 100
  });
  const shiftPill = (pill: SceneLabelPill | undefined): SceneLabelPill | undefined =>
    pill
      ? {
          ...pill,
          x: pill.x + dx,
          y: pill.y + dy,
          lines: pill.lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }))
        }
      : undefined;

  const segments: PathSegment[] = edge.segments.map((seg) =>
    seg.kind === "Q"
      ? {
          kind: "Q",
          cx: Math.round((seg.cx + dx) * 100) / 100,
          cy: Math.round((seg.cy + dy) * 100) / 100,
          x: Math.round((seg.x + dx) * 100) / 100,
          y: Math.round((seg.y + dy) * 100) / 100
        }
      : {
          kind: seg.kind,
          x: Math.round((seg.x + dx) * 100) / 100,
          y: Math.round((seg.y + dy) * 100) / 100
        }
  );
  const d = segments
    .map((s) => (s.kind === "Q" ? `Q ${s.cx} ${s.cy} ${s.x} ${s.y}` : `${s.kind} ${s.x} ${s.y}`))
    .join(" ");

  return {
    ...edge,
    points: edge.points.map(shiftPt),
    segments,
    d,
    startMarker: edge.startMarker
      ? { ...edge.startMarker, tip: shiftPt(edge.startMarker.tip) }
      : undefined,
    endMarker: edge.endMarker
      ? { ...edge.endMarker, tip: shiftPt(edge.endMarker.tip) }
      : undefined,
    labelPill: shiftPill(edge.labelPill),
    sourceLabelPill: shiftPill(edge.sourceLabelPill),
    targetLabelPill: shiftPill(edge.targetLabelPill),
    sourcePort: shiftPt(edge.sourcePort),
    targetPort: shiftPt(edge.targetPort)
  };
}

export function layoutGraphDocument(
  document: MermaidDocument,
  options?: MermaidLayoutOptions
): MermaidScene {
  const limits = admitMermaidLimits(options?.limits, options?.settings?.limits
    ? admitMermaidLimits(options.settings.limits)
    : undefined);
  const budget = options?.budget ?? new MermaidBudget(limits, options?.signal);
  const { tokens: theme, backgroundColor } = resolveMermaidTheme(options);

  const parallelDegree = new Map<string, number>();
  const pairSeen = new Map<string, number>();
  for (const e of document.edges) {
    if (e.from === e.to) continue;
    const pk = e.from < e.to ? e.from + "::" + e.to : e.to + "::" + e.from;
    const c = (pairSeen.get(pk) ?? 0) + 1;
    pairSeen.set(pk, c);
    if (c > 1) {
      parallelDegree.set(e.from, Math.max(parallelDegree.get(e.from) ?? 1, c));
      parallelDegree.set(e.to, Math.max(parallelDegree.get(e.to) ?? 1, c));
    }
  }
  const sizedNodes = document.nodes.map((n) => {
    const base = measureNodeBox(n, theme);
    const pDeg = parallelDegree.get(n.id) ?? 1;
    if (pDeg > 1) {
      return { ...base, height: Math.max(base.height, 64), width: Math.max(base.width, 128) };
    }
    return base;
  });
  const sizedById = new Map(sizedNodes.map((s) => [s.doc.id, s]));
  const groupById = new Map(document.groups.map((g) => [g.id, g]));
  const groupOrder = new Map(document.groups.map((g, i) => [g.id, i]));

  // DFS cycle detection + longest-path ranking
  const adj = new Map<string, string[]>();
  for (const n of document.nodes) adj.set(n.id, []);
  const forwardEdges: { from: string; to: string; label?: string | undefined }[] = [];

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const backEdgeSet = new Set<string>();

  for (const edge of document.edges) {
    if (edge.from === edge.to) continue;
    adj.get(edge.from)?.push(edge.to);
  }

  const dfs = (u: string): void => {
    budget.chargeWork(1);
    visited.add(u);
    inStack.add(u);
    for (const v of adj.get(u) ?? []) {
      if (inStack.has(v)) {
        backEdgeSet.add(`${u}->${v}`);
      } else if (!visited.has(v)) {
        dfs(v);
      }
    }
    inStack.delete(u);
  };

  for (const n of document.nodes) {
    if (!visited.has(n.id)) dfs(n.id);
  }

  for (const edge of document.edges) {
    if (edge.from === edge.to) continue;
    if (backEdgeSet.has(`${edge.from}->${edge.to}`)) continue;
    forwardEdges.push({ from: edge.from, to: edge.to, label: edge.label });
  }

  const rawRank = new Map<string, number>();
  for (const n of document.nodes) rawRank.set(n.id, 0);

  const maxIterations = Math.max(1, document.nodes.length + 2);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const fe of forwardEdges) {
      budget.chargeWork(1);
      const rU = rawRank.get(fe.from) ?? 0;
      const rV = rawRank.get(fe.to) ?? 0;
      if (rV < rU + 1) {
        rawRank.set(fe.to, rU + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  let maxRank = 0;
  for (const r of rawRank.values()) {
    if (r > maxRank) maxRank = r;
  }

  const isReverse = document.direction === "BT" || document.direction === "RL";
  const isHorizontal = document.direction === "LR" || document.direction === "RL";
  const nodeRanks = new Map<string, number>();
  for (const [id, r] of rawRank) {
    nodeRanks.set(id, isReverse ? maxRank - r : r);
  }

  // Group nodes by rank
  const rankLayers: SizedNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const sNode of sizedNodes) {
    const r = nodeRanks.get(sNode.doc.id) ?? 0;
    rankLayers[r]!.push(sNode);
  }

  // Order nodes within each rank so subgraphs stay contiguous
  const sourceIndex = new Map(document.nodes.map((n, i) => [n.id, i]));
  for (const layer of rankLayers) {
    layer.sort((a, b) => {
      const ancA = getGroupAncestors(a.doc.groupId, groupById);
      const ancB = getGroupAncestors(b.doc.groupId, groupById);
      const topA = ancA.length > 0 ? (groupOrder.get(ancA[ancA.length - 1]!) ?? 999) : 999;
      const topB = ancB.length > 0 ? (groupOrder.get(ancB[ancB.length - 1]!) ?? 999) : 999;
      if (topA !== topB) return topA - topB;
      const innerA = a.doc.groupId ? (groupOrder.get(a.doc.groupId) ?? 999) : 999;
      const innerB = b.doc.groupId ? (groupOrder.get(b.doc.groupId) ?? 999) : 999;
      if (innerA !== innerB) return innerA - innerB;
      return (sourceIndex.get(a.doc.id) ?? 0) - (sourceIndex.get(b.doc.id) ?? 0);
    });
  }

  // Compute group rank intervals so we know where group headers/footers open and close
  const groupMinRank = new Map<string, number>();
  const groupMaxRank = new Map<string, number>();
  for (const sNode of sizedNodes) {
    const r = nodeRanks.get(sNode.doc.id) ?? 0;
    for (const gid of getGroupAncestors(sNode.doc.groupId, groupById)) {
      groupMinRank.set(gid, Math.min(groupMinRank.get(gid) ?? Infinity, r));
      groupMaxRank.set(gid, Math.max(groupMaxRank.get(gid) ?? -Infinity, r));
    }
  }

  // Coordinate assignment
  const baseRankGap = isHorizontal ? Math.max(64, theme.rankGap) : theme.rankGap;
  const baseNodeGap = Math.max(36, theme.nodeGap);

  const placedCoords = new Map<string, { x: number; y: number }>();
  let primaryCursor = 80;

  // Find maximum transverse breadth across all layers so ranks can be optically centered
  const layerSpans: {
    readonly items: { readonly node: SizedNode; readonly offset: number }[];
    readonly totalBreadth: number;
    readonly maxPrimarySize: number;
  }[] = [];

  for (let r = 0; r <= maxRank; r++) {
    const layer = rankLayers[r]!;
    let offset = 0;
    let maxPrimarySize = 0;
    const items: { readonly node: SizedNode; readonly offset: number }[] = [];

    for (let i = 0; i < layer.length; i++) {
      const curr = layer[i]!;
      if (i > 0) {
        const prev = layer[i - 1]!;
        const ancPrev = new Set(getGroupAncestors(prev.doc.groupId, groupById));
        const ancCurr = new Set(getGroupAncestors(curr.doc.groupId, groupById));
        let groupBoundaryCrossings = 0;
        for (const g of ancPrev) if (!ancCurr.has(g)) groupBoundaryCrossings++;
        for (const g of ancCurr) if (!ancPrev.has(g)) groupBoundaryCrossings++;
        // If previous layer has a diamond branching to this layer, spread siblings so centers clear the diamond tips by >= 28px
        let diamondSpreadBonus = 0;
        if (r > 0 && layer.length >= 2) {
          for (const prevNode of rankLayers[r - 1] ?? []) {
            if (prevNode.doc.shape === "diamond") {
              const diaSpan = isHorizontal ? prevNode.height : prevNode.width;
              const prevChildBreadth = isHorizontal ? prev.height : prev.width;
              const currChildBreadth = isHorizontal ? curr.height : curr.width;
              const neededGap = Math.max(0, diaSpan + 64 - (prevChildBreadth + currChildBreadth) / 2);
              if (neededGap > baseNodeGap) {
                diamondSpreadBonus = Math.max(diamondSpreadBonus, neededGap - baseNodeGap);
              }
            }
          }
        }
        offset += baseNodeGap + groupBoundaryCrossings * 32 + diamondSpreadBonus;
      }
      items.push({ node: curr, offset });
      const breadth = isHorizontal ? curr.height : curr.width;
      const primary = isHorizontal ? curr.width : curr.height;
      offset += breadth;
      if (primary > maxPrimarySize) maxPrimarySize = primary;
    }
    layerSpans.push({ items, totalBreadth: offset, maxPrimarySize });
  }

  const maxTransverseBreadth = Math.max(200, ...layerSpans.map((l) => l.totalBreadth));

  for (let r = 0; r <= maxRank; r++) {
    // Add top header margin if any groups open at rank r
    let openingGroups = 0;
    for (const [, minR] of groupMinRank) {
      if (minR === r) openingGroups++;
    }
    if (r === 0 && openingGroups > 0) {
      primaryCursor += openingGroups * 56;
    }

    const span = layerSpans[r]!;
    const transverseStart = Math.round((maxTransverseBreadth - span.totalBreadth) / 2) + 80;

    for (const item of span.items) {
      const primaryPos = Math.round(
        primaryCursor + (span.maxPrimarySize - (isHorizontal ? item.node.width : item.node.height)) / 2
      );
      const transversePos = Math.round(transverseStart + item.offset);
      if (isHorizontal) {
        placedCoords.set(item.node.doc.id, { x: primaryPos, y: transversePos });
      } else {
        placedCoords.set(item.node.doc.id, { x: transversePos, y: primaryPos });
      }
    }

    if (r < maxRank) {
      let closingNext = 0;
      let openingNext = 0;
      for (const [, maxR] of groupMaxRank) {
        if (maxR === r) closingNext++;
      }
      for (const [, minR] of groupMinRank) {
        if (minR === r + 1) openingNext++;
      }

      // Check if any edge crossing between r and r+1 carries a label
      let maxLabelAllowance = 0;
      for (const edge of document.edges) {
        const rA = nodeRanks.get(edge.from) ?? 0;
        const rB = nodeRanks.get(edge.to) ?? 0;
        if (Math.min(rA, rB) <= r && Math.max(rA, rB) >= r + 1) {
          if (edge.label || edge.sourceLabel || edge.targetLabel) {
            const text = edge.label ?? edge.sourceLabel ?? edge.targetLabel ?? "";
            const m = measureTextBlock(text, {
              fontSize: theme.secondaryFontSize,
              lineHeight: 16,
              fontFamily: "ui",
              fontWeight: 500
            });
            const needed = (isHorizontal ? m.width + 36 : m.height + 28);
            if (needed > maxLabelAllowance) maxLabelAllowance = needed;
          }
        }
      }

      const groupExtra = closingNext * 28 + openingNext * 58;
      primaryCursor += span.maxPrimarySize + baseRankGap + groupExtra + maxLabelAllowance;
    } else {
      primaryCursor += span.maxPrimarySize;
    }
  }

  const rawSceneNodes: SceneNode[] = sizedNodes.map((s) => {
    const pos = placedCoords.get(s.doc.id) ?? { x: 80, y: 80 };
    return buildSceneNode(s, pos.x, pos.y, theme);
  });

  // Build SceneGroups bottom-up (deepest nesting first)
  const groupsWithDepth = document.groups.map((g) => ({
    doc: g,
    depth: getGroupAncestors(g.id, groupById).length
  }));
  groupsWithDepth.sort((a, b) => b.depth - a.depth);

  const builtGroupById = new Map<string, SceneGroup>();
  for (const { doc: g } of groupsWithDepth) {
    const directNodes = rawSceneNodes.filter((n) => n.groupId === g.id);
    const directSubgroups = document.groups
      .filter((child) => child.parentId === g.id)
      .map((child) => builtGroupById.get(child.id))
      .filter((child): child is SceneGroup => child !== undefined);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of directNodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    }
    for (const sg of directSubgroups) {
      if (sg.x < minX) minX = sg.x;
      if (sg.y < minY) minY = sg.y;
      if (sg.x + sg.width > maxX) maxX = sg.x + sg.width;
      if (sg.y + sg.height > maxY) maxY = sg.y + sg.height;
    }

    if (!Number.isFinite(minX)) {
      minX = 80;
      minY = 80;
      maxX = 200;
      maxY = 140;
    }

    const headerHeight = 32;
    const marginSide = 22;
    const marginTopInner = 22;
    const marginBottom = 22;
    const labelWidth = measureLineWidth(g.label, 12, "ui", 600);

    const naturalSpanW = Math.round(maxX - minX + marginSide * 2);
    const minHeaderClearanceW = snapTo8(labelWidth * 2.3 + 56);
    const gWidth = Math.max(minHeaderClearanceW, naturalSpanW);
    const centerX = (minX + maxX) / 2;
    const gx = Math.round(centerX - gWidth / 2);
    const gy = Math.round(minY - headerHeight - marginTopInner);
    const gHeight = Math.round(maxY - minY + headerHeight + marginTopInner + marginBottom);

    builtGroupById.set(g.id, {
      id: g.id,
      parentId: g.parentId,
      kind: g.kind,
      x: gx,
      y: gy,
      width: gWidth,
      height: gHeight,
      rx: 12,
      fill: theme.groupSurface,
      headerFill: theme.groupHeaderSurface,
      headerHeight,
      stroke: theme.groupBorder,
      strokeWidth: 1.25,
      label: {
        text: g.label,
        width: labelWidth,
        x: gx + 16,
        y: gy + 21,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "ui",
        color: theme.text,
        align: "left"
      }
    });
  }

  // Order groups outer-to-inner so parent backgrounds paint before child subgraphs
  const orderedGroups = groupsWithDepth
    .slice()
    .sort((a, b) => a.depth - b.depth)
    .map((item) => builtGroupById.get(item.doc.id)!)
    .filter(Boolean);

  // Route edges
  const rawEdges = routeGraphEdges(
    document.edges,
    rawSceneNodes,
    orderedGroups,
    document.direction,
    theme,
    nodeRanks
  );

  // Place notes next to target nodes without overlapping any node or group header
  const rawNotes: SceneNote[] = [];
  for (const note of document.notes) {
    const measured = measureTextBlock(note.text, {
      fontSize: theme.secondaryFontSize,
      lineHeight: 16,
      fontFamily: "ui",
      fontWeight: 500
    });
    const nw = Math.max(96, snapTo8(measured.width + 28));
    const nh = Math.max(36, snapTo8(measured.height + 16));
    const targetNode = rawSceneNodes.find((n) => n.id === note.targetIds[0]);
    let nx = targetNode ? targetNode.x + targetNode.width + 32 : 80;
    let ny = targetNode ? targetNode.y : 80;
    if (note.position === "left" && targetNode) {
      nx = targetNode.x - nw - 32;
    }
    while (
      rawSceneNodes.some((n) => rectsIntersect({ x: nx, y: ny, width: nw, height: nh }, n, 24)) ||
      orderedGroups.some((g) =>
        rectsIntersect(
          { x: nx, y: ny, width: nw, height: nh },
          { x: g.x, y: g.y, width: g.width, height: g.headerHeight },
          8
        )
      )
    ) {
      nx += 36;
    }
    rawNotes.push({
      id: note.id,
      x: nx,
      y: ny,
      width: nw,
      height: nh,
      rx: 6,
      fill: theme.noteSurface,
      stroke: theme.noteBorder,
      shadow: true,
      lines: measured.lines.map((l, idx) => ({
        text: l.text,
        width: l.width,
        x: nx + 14,
        y: ny + 19 + idx * 16,
        fontSize: theme.secondaryFontSize,
        fontWeight: 500,
        fontFamily: "ui",
        color: theme.noteText,
        align: "left"
      }))
    });
  }

  // Compute global bounding box across all elements and normalize to [padding, ...]
  let minSceneX = Infinity;
  let minSceneY = Infinity;
  let maxSceneX = -Infinity;
  let maxSceneY = -Infinity;

  const includeRect = (x: number, y: number, w: number, h: number): void => {
    if (x < minSceneX) minSceneX = x;
    if (y < minSceneY) minSceneY = y;
    if (x + w > maxSceneX) maxSceneX = x + w;
    if (y + h > maxSceneY) maxSceneY = y + h;
  };

  for (const n of rawSceneNodes) includeRect(n.x, n.y, n.width, n.height);
  for (const g of orderedGroups) includeRect(g.x, g.y, g.width, g.height);
  for (const note of rawNotes) includeRect(note.x, note.y, note.width, note.height);
  for (const e of rawEdges) {
    for (const pt of e.points) includeRect(pt.x - 4, pt.y - 4, 8, 8);
    if (e.labelPill) includeRect(e.labelPill.x, e.labelPill.y, e.labelPill.width, e.labelPill.height);
    if (e.sourceLabelPill)
      includeRect(
        e.sourceLabelPill.x,
        e.sourceLabelPill.y,
        e.sourceLabelPill.width,
        e.sourceLabelPill.height
      );
    if (e.targetLabelPill)
      includeRect(
        e.targetLabelPill.x,
        e.targetLabelPill.y,
        e.targetLabelPill.width,
        e.targetLabelPill.height
      );
  }

  if (!Number.isFinite(minSceneX)) {
    minSceneX = 0;
    minSceneY = 0;
    maxSceneX = 120;
    maxSceneY = 80;
  }

  const pad = theme.padding;
  const shiftX = Math.round(pad - minSceneX);
  const shiftY = Math.round(pad - minSceneY);

  const finalNodes: SceneNode[] = rawSceneNodes.map((n) => ({
    ...n,
    x: n.x + shiftX,
    y: n.y + shiftY,
    lines: n.lines.map((l) => ({ ...l, x: l.x + shiftX, y: l.y + shiftY })),
    dividers: n.dividers.map((d) => ({
      ...d,
      x1: d.x1 + shiftX,
      y1: d.y1 + shiftY,
      x2: d.x2 + shiftX,
      y2: d.y2 + shiftY
    })),
    badges: n.badges.map((b) => ({
      ...b,
      x: b.x + shiftX,
      y: b.y + shiftY,
      text: { ...b.text, x: b.text.x + shiftX, y: b.text.y + shiftY }
    }))
  }));

  const finalGroups: SceneGroup[] = orderedGroups.map((g) => ({
    ...g,
    x: g.x + shiftX,
    y: g.y + shiftY,
    label: { ...g.label, x: g.label.x + shiftX, y: g.label.y + shiftY }
  }));

  const finalEdges: SceneEdge[] = rawEdges.map((e) => shiftEdge(e, shiftX, shiftY));
  const finalNotes: SceneNote[] = rawNotes.map((note) => ({
    ...note,
    x: note.x + shiftX,
    y: note.y + shiftY,
    lines: note.lines.map((l) => ({ ...l, x: l.x + shiftX, y: l.y + shiftY }))
  }));

  const naturalWidth = Math.ceil(maxSceneX - minSceneX + pad * 2);
  const naturalHeight = Math.ceil(maxSceneY - minSceneY + pad * 2);

  let viewportWidth = naturalWidth;
  let viewportHeight = naturalHeight;
  if (options?.width !== undefined && options?.height !== undefined) {
    if (!Number.isFinite(options.width) || options.width <= 0 || !Number.isFinite(options.height) || options.height <= 0) {
      throw new MermaidError("E_ARGUMENT", "Viewport width and height must be positive finite numbers");
    }
    viewportWidth = Math.round(options.width);
    viewportHeight = Math.round(options.height);
  } else if (options?.width !== undefined) {
    if (!Number.isFinite(options.width) || options.width <= 0) {
      throw new MermaidError("E_ARGUMENT", "Viewport width must be a positive finite number");
    }
    viewportWidth = Math.round(options.width);
    viewportHeight = Math.max(1, Math.round((viewportWidth / naturalWidth) * naturalHeight));
  } else if (options?.height !== undefined) {
    if (!Number.isFinite(options.height) || options.height <= 0) {
      throw new MermaidError("E_ARGUMENT", "Viewport height must be a positive finite number");
    }
    viewportHeight = Math.round(options.height);
    viewportWidth = Math.max(1, Math.round((viewportHeight / naturalHeight) * naturalWidth));
  }

  return {
    family: document.family,
    direction: document.direction,
    width: viewportWidth,
    height: viewportHeight,
    viewBox: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
    naturalBounds: { width: naturalWidth, height: naturalHeight },
    padding: pad,
    theme,
    backgroundColor,
    title: document.title,
    description: document.description,
    groups: finalGroups,
    lifelines: [],
    activations: [],
    edges: finalEdges,
    nodes: finalNodes,
    notes: finalNotes
  };
}
