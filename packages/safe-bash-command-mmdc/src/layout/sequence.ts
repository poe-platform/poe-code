import {
  admitMermaidLimits,
  MermaidBudget,
  type MermaidDocument,
  type MermaidLayoutOptions,
  type MermaidScene,
  type Point,
  type SceneActivation,
  type SceneEdge,
  type SceneGroup,
  type SceneLabelPill,
  type SceneLifeline,
  type SceneMarker,
  type SceneNode,
  type SceneNote,
  type SceneTextLine
} from "../contracts.js";
import { buildRoundedOrthogonalPath } from "../geometry.js";
import { measureLineWidth, measureTextBlock } from "../text.js";
import { resolveMermaidTheme } from "../theme.js";

function snap4(v: number): number {
  return Math.ceil(v / 4) * 4;
}

function snap8(v: number): number {
  return Math.ceil(v / 8) * 8;
}

export function layoutSequenceDocument(
  document: MermaidDocument,
  options?: MermaidLayoutOptions
): MermaidScene {
  const limits = admitMermaidLimits(options?.limits, options?.settings?.limits);
  const budget = options?.budget ?? new MermaidBudget(limits, options?.signal);
  const { tokens: theme, backgroundColor } = resolveMermaidTheme(options);
  const padding = options?.padding ?? theme.padding;

  const participants = document.nodes;
  const pCount = participants.length;
  const pIndexById = new Map<string, number>();
  participants.forEach((p, idx) => pIndexById.set(p.id, idx));

  // Measure participant header/footer cards
  const cardSizes = participants.map((p) => {
    const labelText = p.stereotype === "actor" ? `«actor»\n${p.label}` : p.label;
    const lineHeight = Math.round(13 * 1.35);
    const m = { ...measureTextBlock(labelText, { fontSize: 13, fontWeight: 600, fontFamily: "ui", lineHeight }), lineHeight };
    const width = Math.max(108, snap8(m.width + 32));
    const height = Math.max(44, snap8(m.height + 20));
    return { width, height, metrics: m };
  });

  // Pre-measure messages and notes
  const edgeMetrics = document.edges.map((edge) => {
    if (!edge.label) return null;
    const lineHeight = Math.round(12 * 1.3);
    const m = { ...measureTextBlock(edge.label, { fontSize: 12, fontWeight: 500, fontFamily: "ui", lineHeight }), lineHeight };
    return {
      width: snap4(m.width + 16),
      height: snap4(m.height + 8),
      metrics: m
    };
  });

  const noteMetrics = document.notes.map((note) => {
    const lineHeight = Math.round(12 * 1.35);
    const m = { ...measureTextBlock(note.text, { fontSize: 12, fontWeight: 400, fontFamily: "ui", lineHeight }), lineHeight };
    return {
      width: Math.max(96, snap4(m.width + 24)),
      height: Math.max(36, snap4(m.height + 16)),
      metrics: m
    };
  });

  // Compute participant X centers with pairwise constraints
  const xCenters = new Array<number>(pCount).fill(0);
  for (let i = 1; i < pCount; i++) {
    const prevW = cardSizes[i - 1]!.width;
    const currW = cardSizes[i]!.width;
    xCenters[i] = xCenters[i - 1]! + prevW / 2 + currW / 2 + 56;
  }

  // Enforce pairwise message label and self-loop spacing
  for (let pass = 0; pass < 3; pass++) {
    document.edges.forEach((edge, idx) => {
      const iFrom = pIndexById.get(edge.from) ?? 0;
      const iTo = pIndexById.get(edge.to) ?? 0;
      const pill = edgeMetrics[idx];
      if (iFrom === iTo) {
        const loopRightReach = 54 + (pill ? pill.width + 20 : 16);
        if (iFrom + 1 < pCount) {
          const minNextX =
            xCenters[iFrom]! + loopRightReach + cardSizes[iFrom + 1]!.width / 2;
          if (xCenters[iFrom + 1]! < minNextX) {
            const delta = minNextX - xCenters[iFrom + 1]!;
            for (let k = iFrom + 1; k < pCount; k++) xCenters[k]! += delta;
          }
        }
      } else {
        const leftIdx = Math.min(iFrom, iTo);
        const rightIdx = Math.max(iFrom, iTo);
        const neededSpan = (pill ? pill.width : 48) + 64;
        const currentSpan = xCenters[rightIdx]! - xCenters[leftIdx]!;
        if (currentSpan < neededSpan) {
          const delta = neededSpan - currentSpan;
          for (let k = rightIdx; k < pCount; k++) xCenters[k]! += delta;
        }
      }
    });

    document.notes.forEach((note, idx) => {
      const nm = noteMetrics[idx]!;
      const firstTarget = pIndexById.get(note.targetIds[0] ?? "") ?? 0;
      if (note.position === "right" && firstTarget + 1 < pCount) {
        const needed = 20 + nm.width + 28;
        if (xCenters[firstTarget + 1]! - xCenters[firstTarget]! < needed) {
          const delta = needed - (xCenters[firstTarget + 1]! - xCenters[firstTarget]!);
          for (let k = firstTarget + 1; k < pCount; k++) xCenters[k]! += delta;
        }
      } else if (note.position === "left" && firstTarget > 0) {
        const needed = 20 + nm.width + 28;
        if (xCenters[firstTarget]! - xCenters[firstTarget - 1]! < needed) {
          const delta = needed - (xCenters[firstTarget]! - xCenters[firstTarget - 1]!);
          for (let k = firstTarget; k < pCount; k++) xCenters[k]! += delta;
        }
      }
    });
  }

  // Compute group depth & step boundaries
  const totalSteps = document.edges.length + document.notes.length;
  const groupDepth = new Map<string, number>();
  const computeDepth = (gid: string): number => {
    if (groupDepth.has(gid)) return groupDepth.get(gid)!;
    const g = document.groups.find((x) => x.id === gid);
    if (!g || !g.parentId) {
      groupDepth.set(gid, 0);
      return 0;
    }
    const d = computeDepth(g.parentId) + 1;
    groupDepth.set(gid, d);
    return d;
  };
  document.groups.forEach((g) => computeDepth(g.id));

  // For each group, find minStep and maxStep across all branches
  const groupStepRange = new Map<
    string,
    { minStep: number; maxStep: number; elseBranchStarts: Map<number, string> }
  >();
  for (const g of document.groups) {
    const allSteps: number[] = [];
    const elseBranchStarts = new Map<number, string>();
    if (g.branches) {
      g.branches.forEach((b, bIdx) => {
        for (const s of b.messageIndices) allSteps.push(s);
        if (bIdx > 0 && b.messageIndices.length > 0) {
          elseBranchStarts.set(b.messageIndices[0]!, b.label);
        }
      });
    }
    if (allSteps.length > 0) {
      groupStepRange.set(g.id, {
        minStep: Math.min(...allSteps),
        maxStep: Math.max(...allSteps),
        elseBranchStarts
      });
    }
  }

  const maxHeaderCardH = cardSizes.reduce((acc, c) => Math.max(acc, c.height), 44);
  const topCardY = 0;
  let cursorY = topCardY + maxHeaderCardH + 28;

  const stepTopY = new Array<number>(totalSteps).fill(0);
  const stepArrowY = new Array<number>(totalSteps).fill(0);
  const stepBottomY = new Array<number>(totalSteps).fill(0);
  const groupDividerY = new Map<string, { y: number; label: string }[]>();

  // Index edges and notes by sequenceIndex
  const edgeByStep = new Map<number, { edgeIdx: number }>();
  document.edges.forEach((e, idx) => {
    if (e.sequenceIndex !== undefined) edgeByStep.set(e.sequenceIndex, { edgeIdx: idx });
  });
  const noteByStep = new Map<number, { noteIdx: number }>();
  document.notes.forEach((n, idx) => {
    if (n.sequenceIndex !== undefined) noteByStep.set(n.sequenceIndex, { noteIdx: idx });
  });

  for (let s = 0; s < totalSteps; s++) {
    // Opening blocks before step s (from outer to inner)
    const openingGroups = document.groups
      .filter((g) => groupStepRange.get(g.id)?.minStep === s)
      .sort((a, b) => (groupDepth.get(a.id) ?? 0) - (groupDepth.get(b.id) ?? 0));
    for (let k = 0; k < openingGroups.length; k++) {
      cursorY += 42;
    }

    // Else dividers before step s
    for (const g of document.groups) {
      const range = groupStepRange.get(g.id);
      const elseLabel = range?.elseBranchStarts.get(s);
      if (elseLabel !== undefined) {
        cursorY += 10;
        const divList = groupDividerY.get(g.id) ?? [];
        divList.push({ y: cursorY, label: elseLabel });
        groupDividerY.set(g.id, divList);
        cursorY += 26;
      }
    }

    stepTopY[s] = cursorY;
    const edgeRef = edgeByStep.get(s);
    const noteRef = noteByStep.get(s);

    if (edgeRef) {
      const edge = document.edges[edgeRef.edgeIdx]!;
      const pill = edgeMetrics[edgeRef.edgeIdx];
      if (edge.from === edge.to) {
        const pillH = pill ? pill.height : 22;
        const loopH = Math.max(28, pillH + 6);
        stepArrowY[s] = cursorY + 8;
        cursorY += loopH + 22;
      } else {
        const pillH = pill ? pill.height : 0;
        stepArrowY[s] = cursorY + pillH + 10;
        cursorY = stepArrowY[s]! + 18;
      }
    } else if (noteRef) {
      const nm = noteMetrics[noteRef.noteIdx]!;
      stepArrowY[s] = cursorY;
      cursorY += nm.height + 18;
    } else {
      stepArrowY[s] = cursorY + 14;
      cursorY += 28;
    }

    stepBottomY[s] = cursorY;

    // Closing blocks after step s
    const closingGroups = document.groups.filter(
      (g) => groupStepRange.get(g.id)?.maxStep === s
    );
    for (let k = 0; k < closingGroups.length; k++) {
      cursorY += 20;
    }
  }

  const bottomCardY = cursorY + 16;

  // Compute activations along steps
  const openActivations = new Map<string, { startY: number; depth: number }[]>();
  const rawActivations: { participantId: string; x: number; y: number; width: number; height: number }[] = [];

  const getActiveDepth = (pid: string): number => {
    return (openActivations.get(pid) ?? []).length;
  };

  if (document.activations) {
    // Group activation events by sequenceIndex
    const eventsByStep = new Map<number, typeof document.activations[number][]>();
    for (const ev of document.activations) {
      const list = eventsByStep.get(ev.sequenceIndex) ?? [];
      list.push(ev);
      eventsByStep.set(ev.sequenceIndex, list);
    }

    for (let s = 0; s < Math.max(1, totalSteps); s++) {
      const evs = eventsByStep.get(s) ?? [];
      const yAtStep = stepArrowY[s] ?? topCardY + maxHeaderCardH + 20;
      for (const ev of evs) {
        const stack = openActivations.get(ev.participantId) ?? [];
        if (ev.action === "activate") {
          stack.push({ startY: yAtStep, depth: stack.length });
          openActivations.set(ev.participantId, stack);
        } else {
          const popped = stack.pop();
          if (popped) {
            const pIdx = pIndexById.get(ev.participantId) ?? 0;
            const cx = xCenters[pIdx]!;
            const barX = cx - 5 + popped.depth * 4;
            const barH = Math.max(16, yAtStep - popped.startY);
            rawActivations.push({
              participantId: ev.participantId,
              x: barX,
              y: popped.startY,
              width: 10,
              height: barH
            });
          }
        }
      }
    }

    // Close any remaining open activations before bottom footer cards
    for (const [pid, stack] of openActivations.entries()) {
      const pIdx = pIndexById.get(pid) ?? 0;
      const cx = xCenters[pIdx]!;
      while (stack.length > 0) {
        const popped = stack.pop()!;
        const barX = cx - 5 + popped.depth * 4;
        const endY = Math.max(popped.startY + 20, bottomCardY - 14);
        rawActivations.push({
          participantId: pid,
          x: barX,
          y: popped.startY,
          width: 10,
          height: endY - popped.startY
        });
      }
    }
  }

  const isParticipantActiveAtY = (pid: string, y: number): { active: boolean; depth: number } => {
    let maxD = -1;
    for (const act of rawActivations) {
      if (act.participantId === pid && y >= act.y - 1 && y <= act.y + act.height + 1) {
        const pIdx = pIndexById.get(pid) ?? 0;
        const d = Math.round((act.x - (xCenters[pIdx]! - 5)) / 4);
        if (d > maxD) maxD = d;
      }
    }
    return { active: maxD >= 0, depth: Math.max(0, maxD) };
  };

  // Build edges and track horizontal extents per step for block sizing
  const stepMinX = new Array<number>(totalSteps).fill(Infinity);
  const stepMaxX = new Array<number>(totalSteps).fill(-Infinity);

  const rawEdges: SceneEdge[] = [];
  document.edges.forEach((edge, idx) => {
    const s = edge.sequenceIndex ?? idx;
    const iFrom = pIndexById.get(edge.from) ?? 0;
    const iTo = pIndexById.get(edge.to) ?? 0;
    const cxFrom = xCenters[iFrom]!;
    const cxTo = xCenters[iTo]!;
    const y = stepArrowY[s]!;
    const pillInfo = edgeMetrics[idx];

    if (iFrom === iTo) {
      const actState = isParticipantActiveAtY(edge.from, y);
      const rightEdgeX = actState.active ? cxFrom + 5 + actState.depth * 4 : cxFrom;
      const pillH = pillInfo ? pillInfo.height : 22;
      const loopH = Math.max(28, pillH + 6);
      const y1 = y;
      const y2 = y + loopH;
      const loopX = rightEdgeX + 42;
      const startPt: Point = { x: rightEdgeX, y: y1 };
      const endPt: Point = { x: rightEdgeX, y: y2 };
      const pullback = edge.endMarker === "arrow" ? 6.8 : edge.endMarker === "cross" ? 5 : 0;
      const waypoints: Point[] = [
        startPt,
        { x: loopX, y: y1 },
        { x: loopX, y: y2 },
        endPt
      ];
      const built = buildRoundedOrthogonalPath(waypoints, 6, pullback);

      let labelPill: SceneLabelPill | undefined;
      if (pillInfo) {
        const px = loopX + 10;
        const py = Math.round((y1 + y2) / 2 - pillInfo.height / 2);
        const lines: SceneTextLine[] = pillInfo.metrics.lines.map((l, lIdx) => ({
          text: l.text,
          width: l.width,
          x: px + pillInfo.width / 2,
          y: py + 4 + (lIdx + 0.78) * pillInfo.metrics.lineHeight,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "ui",
          color: theme.text,
          align: "center"
        }));
        labelPill = {
          x: px,
          y: py,
          width: pillInfo.width,
          height: pillInfo.height,
          rx: 5,
          fill: theme.edgeLabelBackground,
          stroke: theme.edgeLabelBorder,
          lines
        };
        stepMinX[s] = Math.min(stepMinX[s]!, cxFrom - 12);
        stepMaxX[s] = Math.max(stepMaxX[s]!, px + pillInfo.width);
      } else {
        stepMinX[s] = Math.min(stepMinX[s]!, cxFrom - 12);
        stepMaxX[s] = Math.max(stepMaxX[s]!, loopX);
      }

      const endMarker: SceneMarker | undefined =
        edge.endMarker === "none"
          ? undefined
          : {
              kind: edge.endMarker,
              tip: endPt,
              angleRadians: Math.PI,
              stroke: theme.edge,
              fill: theme.edge
            };

      rawEdges.push({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        points: waypoints,
        segments: built.segments,
        d: built.d,
        stroke: theme.edge,
        strokeWidth: 1.5,
        lineStyle: edge.lineStyle,
        startMarker: undefined,
        endMarker,
        labelPill,
        sourcePort: startPt,
        targetPort: endPt,
        sourceNormal: { x: 1, y: 0 },
        targetNormal: { x: 1, y: 0 }
      });
    } else {
      const goingRight = cxTo > cxFrom;
      const srcAct = isParticipantActiveAtY(edge.from, y);
      const dstAct = isParticipantActiveAtY(edge.to, y);
      const startX = srcAct.active
        ? cxFrom + (goingRight ? 5 + srcAct.depth * 4 : -5)
        : cxFrom;
      const endX = dstAct.active
        ? cxTo + (goingRight ? -5 : 5 + dstAct.depth * 4)
        : cxTo;

      const startPt: Point = { x: startX, y };
      const endPt: Point = { x: endX, y };
      const pullback = edge.endMarker === "arrow" ? 6.8 : edge.endMarker === "cross" ? 5 : 0;
      const lineEndX = goingRight ? endX - pullback : endX + pullback;

      let labelPill: SceneLabelPill | undefined;
      if (pillInfo) {
        const midX = (startX + endX) / 2;
        const px = Math.round(midX - pillInfo.width / 2);
        const py = Math.round(y - 6 - pillInfo.height);
        const lines: SceneTextLine[] = pillInfo.metrics.lines.map((l, lIdx) => ({
          text: l.text,
          width: l.width,
          x: px + pillInfo.width / 2,
          y: py + 4 + (lIdx + 0.78) * pillInfo.metrics.lineHeight,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "ui",
          color: theme.text,
          align: "center"
        }));
        labelPill = {
          x: px,
          y: py,
          width: pillInfo.width,
          height: pillInfo.height,
          rx: 5,
          fill: theme.edgeLabelBackground,
          stroke: theme.edgeLabelBorder,
          lines
        };
      }

      stepMinX[s] = Math.min(stepMinX[s]!, Math.min(cxFrom, cxTo) - 12);
      stepMaxX[s] = Math.max(stepMaxX[s]!, Math.max(cxFrom, cxTo) + 12);

      const endMarker: SceneMarker | undefined =
        edge.endMarker === "none"
          ? undefined
          : {
              kind: edge.endMarker,
              tip: endPt,
              angleRadians: goingRight ? 0 : Math.PI,
              stroke: theme.edge,
              fill: theme.edge
            };

      rawEdges.push({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        points: [startPt, endPt],
        segments: [
          { kind: "M", x: startX, y },
          { kind: "L", x: lineEndX, y }
        ],
        d: `M ${startX} ${y} L ${lineEndX} ${y}`,
        stroke: theme.edge,
        strokeWidth: 1.5,
        lineStyle: edge.lineStyle,
        startMarker: undefined,
        endMarker,
        labelPill,
        sourcePort: startPt,
        targetPort: endPt,
        sourceNormal: { x: goingRight ? 1 : -1, y: 0 },
        targetNormal: { x: goingRight ? -1 : 1, y: 0 }
      });
    }
  });

  // Build notes
  const rawNotes: SceneNote[] = [];
  document.notes.forEach((note, idx) => {
    const s = note.sequenceIndex ?? idx;
    const nm = noteMetrics[idx]!;
    const targetIndices = note.targetIds.map((id) => pIndexById.get(id) ?? 0);
    const minP = Math.min(...targetIndices);
    const maxP = Math.max(...targetIndices);
    const ny = stepTopY[s]!;
    let nx: number;
    let nw = nm.width;

    if (note.position === "left") {
      nx = xCenters[minP]! - 18 - nw;
    } else if (note.position === "right") {
      nx = xCenters[maxP]! + 18;
    } else {
      const spanW = xCenters[maxP]! - xCenters[minP]!;
      nw = Math.max(nw, spanW + 48);
      nx = Math.round((xCenters[minP]! + xCenters[maxP]!) / 2 - nw / 2);
    }

    stepMinX[s] = Math.min(stepMinX[s]!, nx);
    stepMaxX[s] = Math.max(stepMaxX[s]!, nx + nw);

    const lines: SceneTextLine[] = nm.metrics.lines.map((l, lIdx) => ({
      text: l.text,
      width: l.width,
      x: nx + nw / 2,
      y: ny + 8 + (lIdx + 0.78) * nm.metrics.lineHeight,
      fontSize: 12,
      fontWeight: 400,
      fontFamily: "ui",
      color: theme.text,
      align: "center"
    }));

    rawNotes.push({
      id: note.id,
      x: nx,
      y: ny,
      width: nw,
      height: nm.height,
      rx: 6,
      fill: theme.noteSurface,
      stroke: theme.noteBorder,
      shadow: true,
      lines
    });
  });

  // Build sequence block groups (inside-out so parent blocks enclose children by >= 16px)
  const sortedGroupsInnerFirst = [...document.groups].sort(
    (a, b) => (groupDepth.get(b.id) ?? 0) - (groupDepth.get(a.id) ?? 0)
  );
  const builtGroupById = new Map<string, SceneGroup>();

  for (const g of sortedGroupsInnerFirst) {
    const range = groupStepRange.get(g.id);
    if (!range) continue;
    let gxMin = Infinity;
    let gxMax = -Infinity;
    for (let s = range.minStep; s <= range.maxStep; s++) {
      gxMin = Math.min(gxMin, stepMinX[s]!);
      gxMax = Math.max(gxMax, stepMaxX[s]!);
    }
    if (!Number.isFinite(gxMin)) {
      gxMin = xCenters[0]! - 40;
      gxMax = xCenters[pCount - 1]! + 40;
    }

    let gyMin = stepTopY[range.minStep]! - 38;
    let gyMax = stepBottomY[range.maxStep]! + 12;

    // Expand to enclose any child sequence blocks with >= 18px margin
    for (const child of document.groups) {
      if (child.parentId === g.id) {
        const childScene = builtGroupById.get(child.id);
        if (childScene) {
          gxMin = Math.min(gxMin, childScene.x - 18);
          gxMax = Math.max(gxMax, childScene.x + childScene.width + 18);
          gyMin = Math.min(gyMin, childScene.y - 36);
          gyMax = Math.max(gyMax, childScene.y + childScene.height + 18);
        }
      }
    }

    const headerTitle = `${(g.blockKeyword ?? "loop").toUpperCase()}  [${g.label}]`;
    const titleMetric = { width: measureLineWidth(headerTitle, 12, "ui", 600) };
    const gx = Math.floor(gxMin - 20);
    const gw = Math.max(snap4(gxMax - gxMin + 40), snap4(titleMetric.width + 32));
    const gy = Math.floor(gyMin);
    const gh = Math.ceil(gyMax - gyMin);

    const dividers = (groupDividerY.get(g.id) ?? []).map((div) => {
      const divTitle = `[${div.label}]`;
      const dm = { width: measureLineWidth(divTitle, 11, "ui", 600) };
      return {
        y: div.y,
        label: {
          text: divTitle,
          width: dm.width,
          x: gx + 12,
          y: div.y + 15,
          fontSize: 11,
          fontWeight: 600 as const,
          fontFamily: "ui" as const,
          color: theme.mutedText,
          align: "left" as const
        }
      };
    });

    const sceneGroup: SceneGroup = {
      id: g.id,
      parentId: g.parentId,
      kind: "sequenceBlock",
      x: gx,
      y: gy,
      width: gw,
      height: gh,
      rx: 8,
      fill: theme.groupSurface,
      headerFill: theme.surfaceElevated,
      headerHeight: 28,
      stroke: theme.groupBorder,
      strokeWidth: 1.25,
      dashed: true,
      label: {
        text: headerTitle,
        width: titleMetric.width,
        x: gx + 12,
        y: gy + 18,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "ui",
        color: theme.text,
        align: "left"
      },
      sectionDividers: dividers.length > 0 ? dividers : undefined
    };
    builtGroupById.set(g.id, sceneGroup);
  }

  // Build top & bottom participant nodes + lifelines
  const rawNodes: SceneNode[] = [];
  const rawLifelines: SceneLifeline[] = [];

  participants.forEach((p, idx) => {
    const cx = xCenters[idx]!;
    const cs = cardSizes[idx]!;
    const buildCard = (cardId: string, cardY: number): SceneNode => {
      const nx = Math.round(cx - cs.width / 2);
      const lines: SceneTextLine[] = cs.metrics.lines.map((l, lIdx) => ({
        text: l.text,
        width: l.width,
        x: nx + cs.width / 2,
        y: cardY + 10 + (lIdx + 0.78) * cs.metrics.lineHeight,
        fontSize: lIdx === 0 && p.stereotype === "actor" ? 11 : 13,
        fontWeight: lIdx === 0 && p.stereotype === "actor" ? 500 : 600,
        fontFamily: "ui",
        color: lIdx === 0 && p.stereotype === "actor" ? theme.mutedText : theme.text,
        align: "center"
      }));
      return {
        id: cardId,
        shape: "participant",
        x: nx,
        y: cardY,
        width: cs.width,
        height: cs.height,
        rx: 8,
        fill: theme.surface,
        stroke: p.stereotype === "actor" ? theme.accentBorder : theme.border,
        strokeWidth: 1.5,
        shadow: true,
        lines,
        dividers: [],
        badges: []
      };
    };

    rawNodes.push(buildCard(p.id, topCardY));
    rawNodes.push(buildCard(`${p.id}__footer`, bottomCardY));
    rawLifelines.push({
      participantId: p.id,
      x: cx,
      y1: topCardY + cs.height,
      y2: bottomCardY,
      stroke: theme.borderStrong
    });
  });

  // Compute global bounding box and normalize to [padding, ...]
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includeRect = (x: number, y: number, w: number, h: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  for (const n of rawNodes) includeRect(n.x, n.y, n.width, n.height);
  for (const g of builtGroupById.values()) includeRect(g.x, g.y, g.width, g.height);
  for (const note of rawNotes) includeRect(note.x, note.y, note.width, note.height);
  for (const e of rawEdges) {
    if (e.labelPill) includeRect(e.labelPill.x, e.labelPill.y, e.labelPill.width, e.labelPill.height);
    for (const pt of e.points) includeRect(pt.x, pt.y, 0, 0);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 160;
    maxY = 100;
  }

  const dx = Math.round(padding - minX);
  const dy = Math.round(padding - minY);

  const shiftLine = (l: SceneTextLine): SceneTextLine => ({
    ...l,
    x: l.x + dx,
    y: l.y + dy
  });

  const shiftPill = (p: SceneLabelPill | undefined): SceneLabelPill | undefined =>
    p
      ? {
          ...p,
          x: p.x + dx,
          y: p.y + dy,
          lines: p.lines.map(shiftLine)
        }
      : undefined;

  const nodes: SceneNode[] = rawNodes.map((n) => ({
    ...n,
    x: n.x + dx,
    y: n.y + dy,
    lines: n.lines.map(shiftLine)
  }));

  const groups: SceneGroup[] = [...document.groups]
    .sort((a, b) => (groupDepth.get(a.id) ?? 0) - (groupDepth.get(b.id) ?? 0))
    .map((g) => builtGroupById.get(g.id))
    .filter((g): g is SceneGroup => g !== undefined)
    .map((g) => ({
      ...g,
      x: g.x + dx,
      y: g.y + dy,
      label: shiftLine(g.label),
      sectionDividers: g.sectionDividers?.map((d) => ({
        y: d.y + dy,
        label: d.label ? shiftLine(d.label) : undefined
      }))
    }));

  const lifelines: SceneLifeline[] = rawLifelines.map((l) => ({
    ...l,
    x: l.x + dx,
    y1: l.y1 + dy,
    y2: l.y2 + dy
  }));

  const activations: SceneActivation[] = rawActivations.map((a) => ({
    ...a,
    x: a.x + dx,
    y: a.y + dy,
    fill: theme.accentSurface,
    stroke: theme.accentBorder
  }));

  const edges: SceneEdge[] = rawEdges.map((e) => {
    const shiftedPoints = e.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
    const shiftedSegments = e.segments.map((seg) =>
      seg.kind === "Q"
        ? { ...seg, cx: seg.cx + dx, cy: seg.cy + dy, x: seg.x + dx, y: seg.y + dy }
        : { ...seg, x: seg.x + dx, y: seg.y + dy }
    );
    const d = shiftedSegments
      .map((seg) =>
        seg.kind === "M"
          ? `M ${seg.x} ${seg.y}`
          : seg.kind === "L"
            ? `L ${seg.x} ${seg.y}`
            : `Q ${seg.cx} ${seg.cy} ${seg.x} ${seg.y}`
      )
      .join(" ");
    return {
      ...e,
      points: shiftedPoints,
      segments: shiftedSegments,
      d,
      endMarker: e.endMarker
        ? {
            ...e.endMarker,
            tip: { x: e.endMarker.tip.x + dx, y: e.endMarker.tip.y + dy }
          }
        : undefined,
      labelPill: shiftPill(e.labelPill),
      sourcePort: { x: e.sourcePort.x + dx, y: e.sourcePort.y + dy },
      targetPort: { x: e.targetPort.x + dx, y: e.targetPort.y + dy }
    };
  });

  const notes: SceneNote[] = rawNotes.map((n) => ({
    ...n,
    x: n.x + dx,
    y: n.y + dy,
    lines: n.lines.map(shiftLine)
  }));

  const naturalWidth = Math.ceil(maxX - minX + padding * 2);
  const naturalHeight = Math.ceil(maxY - minY + padding * 2);
  const width = options?.width ?? naturalWidth;
  const height = options?.height ?? naturalHeight;

  budget.chargeWork(nodes.length * 10 + edges.length * 15);

  return {
    family: "sequence",
    direction: "TD",
    width,
    height,
    viewBox: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
    naturalBounds: { width: naturalWidth, height: naturalHeight },
    padding,
    theme,
    backgroundColor,
    title: document.title,
    description: document.description,
    groups,
    lifelines,
    activations,
    edges,
    nodes,
    notes
  };
}
