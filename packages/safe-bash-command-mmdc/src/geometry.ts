import type {
  EdgeMarkerKind,
  MermaidScene,
  PathSegment,
  Point,
  Rect,
  SceneNode
} from "./contracts.js";

export type PortFace = "top" | "bottom" | "left" | "right";

export function snapTo8(value: number): number {
  return Math.ceil(value / 8) * 8;
}

export function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

export function rectClearance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  if (dx === 0 && dy === 0) {
    // Overlapping
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return -Math.min(overlapX, overlapY);
  }
  return Math.max(dx, dy);
}

export function faceNormal(face: PortFace): Point {
  switch (face) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

export function pointOnNodePerimeter(
  node: Pick<SceneNode, "shape" | "x" | "y" | "width" | "height" | "rx">,
  face: PortFace,
  offsetFromCenter: number
): { readonly port: Point; readonly normal: Point; readonly stubPoint: Point } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const normal = faceNormal(face);
  const stubBase = 18;

  if (node.shape === "diamond") {
    if (face === "top" || face === "bottom") {
      const maxOff = Math.max(0, hw * 0.65);
      const dx = Math.max(-maxOff, Math.min(maxOff, offsetFromCenter));
      const ratio = hw > 0 ? Math.abs(dx) / hw : 0;
      const py = face === "top" ? cy - hh * (1 - ratio) : cy + hh * (1 - ratio);
      const sy = face === "top" ? node.y - stubBase : node.y + node.height + stubBase;
      return {
        port: { x: Math.round((cx + dx) * 100) / 100, y: Math.round(py * 100) / 100 },
        normal,
        stubPoint: { x: Math.round((cx + dx) * 100) / 100, y: Math.round(sy * 100) / 100 }
      };
    } else {
      const maxOff = Math.max(0, hh * 0.65);
      const dy = Math.max(-maxOff, Math.min(maxOff, offsetFromCenter));
      const ratio = hh > 0 ? Math.abs(dy) / hh : 0;
      const px = face === "left" ? cx - hw * (1 - ratio) : cx + hw * (1 - ratio);
      const sx = face === "left" ? node.x - stubBase : node.x + node.width + stubBase;
      return {
        port: { x: Math.round(px * 100) / 100, y: Math.round((cy + dy) * 100) / 100 },
        normal,
        stubPoint: { x: Math.round(sx * 100) / 100, y: Math.round((cy + dy) * 100) / 100 }
      };
    }
  }

  if (
    node.shape === "circle" ||
    node.shape === "stateStart" ||
    node.shape === "stateEnd"
  ) {
    const r = Math.min(hw, hh);
    const maxOff = r * 0.65;
    if (face === "top" || face === "bottom") {
      const dx = Math.max(-maxOff, Math.min(maxOff, offsetFromCenter));
      const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
      const py = face === "top" ? cy - dy : cy + dy;
      const sy = face === "top" ? cy - r - stubBase : cy + r + stubBase;
      return {
        port: { x: Math.round((cx + dx) * 100) / 100, y: Math.round(py * 100) / 100 },
        normal,
        stubPoint: { x: Math.round((cx + dx) * 100) / 100, y: Math.round(sy * 100) / 100 }
      };
    } else {
      const dy = Math.max(-maxOff, Math.min(maxOff, offsetFromCenter));
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
      const px = face === "left" ? cx - dx : cx + dx;
      const sx = face === "left" ? cx - r - stubBase : cx + r + stubBase;
      return {
        port: { x: Math.round(px * 100) / 100, y: Math.round((cy + dy) * 100) / 100 },
        normal,
        stubPoint: { x: Math.round(sx * 100) / 100, y: Math.round((cy + dy) * 100) / 100 }
      };
    }
  }

  // Rectangular / rounded / stadium / classCard / erEntity / participant
  const cornerAllowance = Math.min(node.rx + 4, Math.min(hw, hh) * 0.6);
  if (face === "top" || face === "bottom") {
    const maxOff = Math.max(0, hw - cornerAllowance);
    const dx = Math.max(-maxOff, Math.min(maxOff, offsetFromCenter));
    const px = Math.round((cx + dx) * 100) / 100;
    const py = face === "top" ? node.y : node.y + node.height;
    const sy = face === "top" ? node.y - stubBase : node.y + node.height + stubBase;
    return {
      port: { x: px, y: py },
      normal,
      stubPoint: { x: px, y: sy }
    };
  } else {
    const maxOff = Math.max(0, hh - cornerAllowance);
    const dy = Math.max(-maxOff, Math.min(maxOff, offsetFromCenter));
    const py = Math.round((cy + dy) * 100) / 100;
    const px = face === "left" ? node.x : node.x + node.width;
    const sx = face === "left" ? node.x - stubBase : node.x + node.width + stubBase;
    return {
      port: { x: px, y: py },
      normal,
      stubPoint: { x: sx, y: py }
    };
  }
}

export function distanceToNodePerimeter(
  pt: Point,
  node: Pick<SceneNode, "shape" | "x" | "y" | "width" | "height">
): number {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hw = node.width / 2;
  const hh = node.height / 2;

  if (node.shape === "diamond") {
    // L1 norm boundary: |x - cx|/hw + |y - cy|/hh = 1
    const val = Math.abs(pt.x - cx) / hw + Math.abs(pt.y - cy) / hh;
    return Math.abs(val - 1) * Math.min(hw, hh);
  }

  if (
    node.shape === "circle" ||
    node.shape === "stateStart" ||
    node.shape === "stateEnd"
  ) {
    const r = Math.min(hw, hh);
    const dist = Math.hypot(pt.x - cx, pt.y - cy);
    return Math.abs(dist - r);
  }

  const dx = Math.max(node.x - pt.x, 0, pt.x - (node.x + node.width));
  const dy = Math.max(node.y - pt.y, 0, pt.y - (node.y + node.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(
    Math.abs(pt.x - node.x),
    Math.abs(pt.x - (node.x + node.width)),
    Math.abs(pt.y - node.y),
    Math.abs(pt.y - (node.y + node.height))
  );
}

export function markerPullbackDistance(kind: EdgeMarkerKind): number {
  switch (kind) {
    case "arrow":
      return 6.8;
    case "umlHollowTriangle":
      return 9.5;
    case "umlComposition":
    case "umlAggregation":
      return 11.5;
    default:
      return 0;
  }
}

export function buildRoundedOrthogonalPath(
  rawPoints: readonly Point[],
  elbowRadius: number,
  startMarker: EdgeMarkerKind,
  endMarker: EdgeMarkerKind
): { readonly points: readonly Point[]; readonly segments: readonly PathSegment[]; readonly d: string } {
  // Deduplicate consecutive identical points
  const pts: Point[] = [];
  for (const p of rawPoints) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.25) {
      pts.push({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
    }
  }
  if (pts.length < 2) {
    const fallback = pts[0] ?? { x: 0, y: 0 };
    return {
      points: [fallback, fallback],
      segments: [{ kind: "M", x: fallback.x, y: fallback.y }],
      d: `M ${fallback.x} ${fallback.y}`
    };
  }

  const strokePts = pts.map((p) => ({ ...p }));
  const startPull = markerPullbackDistance(startMarker);
  if (startPull > 0 && strokePts.length >= 2) {
    const p0 = strokePts[0]!;
    const p1 = strokePts[1]!;
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (len > startPull + 1) {
      strokePts[0] = {
        x: Math.round((p0.x + ((p1.x - p0.x) / len) * startPull) * 100) / 100,
        y: Math.round((p0.y + ((p1.y - p0.y) / len) * startPull) * 100) / 100
      };
    }
  }

  const endPull = markerPullbackDistance(endMarker);
  if (endPull > 0 && strokePts.length >= 2) {
    const lastIdx = strokePts.length - 1;
    const pn = strokePts[lastIdx]!;
    const prev = strokePts[lastIdx - 1]!;
    const len = Math.hypot(pn.x - prev.x, pn.y - prev.y);
    if (len > endPull + 1) {
      strokePts[lastIdx] = {
        x: Math.round((pn.x - ((pn.x - prev.x) / len) * endPull) * 100) / 100,
        y: Math.round((pn.y - ((pn.y - prev.y) / len) * endPull) * 100) / 100
      };
    }
  }

  const segments: PathSegment[] = [{ kind: "M", x: strokePts[0]!.x, y: strokePts[0]!.y }];
  let d = `M ${strokePts[0]!.x} ${strokePts[0]!.y}`;

  for (let i = 1; i < strokePts.length - 1; i++) {
    const prev = strokePts[i - 1]!;
    const curr = strokePts[i]!;
    const next = strokePts[i + 1]!;

    const lenA = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenB = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(elbowRadius, lenA * 0.45, lenB * 0.45);

    if (r < 1) {
      segments.push({ kind: "L", x: curr.x, y: curr.y });
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const enterX = Math.round((curr.x - ((curr.x - prev.x) / lenA) * r) * 100) / 100;
    const enterY = Math.round((curr.y - ((curr.y - prev.y) / lenA) * r) * 100) / 100;
    const exitX = Math.round((curr.x + ((next.x - curr.x) / lenB) * r) * 100) / 100;
    const exitY = Math.round((curr.y + ((next.y - curr.y) / lenB) * r) * 100) / 100;

    segments.push({ kind: "L", x: enterX, y: enterY });
    segments.push({ kind: "Q", cx: curr.x, cy: curr.y, x: exitX, y: exitY });
    d += ` L ${enterX} ${enterY} Q ${curr.x} ${curr.y} ${exitX} ${exitY}`;
  }

  const endPt = strokePts[strokePts.length - 1]!;
  segments.push({ kind: "L", x: endPt.x, y: endPt.y });
  d += ` L ${endPt.x} ${endPt.y}`;

  return { points: pts, segments, d };
}

export interface GeometryReport {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export function verifySceneGeometry(scene: MermaidScene): GeometryReport {
  const violations: string[] = [];
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
  const groupById = new Map(scene.groups.map((g) => [g.id, g]));

  // 1. Zero node-to-node overlap & minimum sibling clearance >= 24px
  for (let i = 0; i < scene.nodes.length; i++) {
    const a = scene.nodes[i]!;
    for (let j = i + 1; j < scene.nodes.length; j++) {
      const b = scene.nodes[j]!;
      const clearance = rectClearance(a, b);
      if (clearance < 24 - 0.01) {
        violations.push(
          `Invariant 1 (node clearance): nodes '${a.id}' and '${b.id}' have clearance ${clearance.toFixed(2)}px (< 24px)`
        );
      }
    }
  }

  // 2. Zero label collision (no edge label pill overlaps any node border or another label pill)
  const allPills: { readonly id: string; readonly rect: Rect }[] = [];
  for (const edge of scene.edges) {
    if (edge.labelPill) allPills.push({ id: `${edge.id}:label`, rect: edge.labelPill });
    if (edge.sourceLabelPill)
      allPills.push({ id: `${edge.id}:srcLabel`, rect: edge.sourceLabelPill });
    if (edge.targetLabelPill)
      allPills.push({ id: `${edge.id}:dstLabel`, rect: edge.targetLabelPill });
  }
  for (const pill of allPills) {
    for (const node of scene.nodes) {
      if (rectsIntersect(pill.rect, node, -0.5)) {
        violations.push(
          `Invariant 2 (label collision): pill '${pill.id}' overlaps node '${node.id}'`
        );
      }
    }
  }
  for (let i = 0; i < allPills.length; i++) {
    for (let j = i + 1; j < allPills.length; j++) {
      if (rectsIntersect(allPills[i]!.rect, allPills[j]!.rect, -0.5)) {
        violations.push(
          `Invariant 2 (pill collision): '${allPills[i]!.id}' overlaps '${allPills[j]!.id}'`
        );
      }
    }
  }

  // 3. Subgraph containment & header clearance (>= 16px inner margin, no overlap with 32px header band)
  for (const group of scene.groups) {
    if (group.kind === "sequenceBlock") continue;
    const headerBand: Rect = {
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.headerHeight
    };
    for (const node of scene.nodes) {
      if (rectsIntersect(node, headerBand, -0.5)) {
        violations.push(
          `Invariant 3 (header clearance): node '${node.id}' overlaps header band of group '${group.id}'`
        );
      }
      if (node.groupId === group.id) {
        const leftMargin = node.x - group.x;
        const rightMargin = group.x + group.width - (node.x + node.width);
        const topMargin = node.y - (group.y + group.headerHeight);
        const bottomMargin = group.y + group.height - (node.y + node.height);
        if (
          leftMargin < 16 - 0.1 ||
          rightMargin < 16 - 0.1 ||
          topMargin < 16 - 0.1 ||
          bottomMargin < 16 - 0.1
        ) {
          violations.push(
            `Invariant 3 (subgraph containment): child node '${node.id}' in '${group.id}' has margins L=${leftMargin} R=${rightMargin} T=${topMargin} B=${bottomMargin} (< 16px)`
          );
        }
      }
    }
    for (const pill of allPills) {
      if (rectsIntersect(pill.rect, headerBand, -0.5)) {
        violations.push(
          `Invariant 3 (pill header clearance): pill '${pill.id}' overlaps header band of '${group.id}'`
        );
      }
    }
    if (group.parentId) {
      const parent = groupById.get(group.parentId);
      if (parent) {
        const leftMargin = group.x - parent.x;
        const rightMargin = parent.x + parent.width - (group.x + group.width);
        const topMargin = group.y - (parent.y + parent.headerHeight);
        const bottomMargin = parent.y + parent.height - (group.y + group.height);
        if (
          leftMargin < 16 - 0.1 ||
          rightMargin < 16 - 0.1 ||
          topMargin < 16 - 0.1 ||
          bottomMargin < 16 - 0.1
        ) {
          violations.push(
            `Invariant 3 (nested subgraph containment): '${group.id}' in '${parent.id}' has margins L=${leftMargin} R=${rightMargin} T=${topMargin} B=${bottomMargin} (< 16px)`
          );
        }
      }
    }
  }


  const isGroupAncestor = (ancestorId: string, descId: string): boolean => {
    let curr = groupById.get(descId)?.parentId;
    while (curr) {
      if (curr === ancestorId) return true;
      curr = groupById.get(curr)?.parentId;
    }
    return false;
  };
  for (let i = 0; i < scene.groups.length; i++) {
    const g1 = scene.groups[i]!;
    if (g1.kind === "sequenceBlock") continue;
    for (let j = i + 1; j < scene.groups.length; j++) {
      const g2 = scene.groups[j]!;
      if (g2.kind === "sequenceBlock") continue;
      if (isGroupAncestor(g1.id, g2.id) || isGroupAncestor(g2.id, g1.id)) continue;
      const gClearance = rectClearance(g1, g2);
      if (gClearance < 16 - 0.1) {
        violations.push(
          `Invariant 3 (disjoint group clearance): groups "${g1.id}" and "${g2.id}" have clearance ${gClearance.toFixed(2)}px (< 16px)`
        );
      }
    }
  }

  // 4. Perpendicular port & arrow attachment
  if (scene.family !== "sequence") {
    for (const edge of scene.edges) {
      const srcNode = nodeById.get(edge.from);
      const dstNode = nodeById.get(edge.to);
      if (!srcNode || !dstNode || edge.points.length < 2) continue;

      const startPt = edge.points[0]!;
      const endPt = edge.points[edge.points.length - 1]!;
      const srcGroup = srcNode.groupId ? groupById.get(srcNode.groupId) : undefined;
      const dstGroup = dstNode.groupId ? groupById.get(dstNode.groupId) : undefined;
      const srcDist = Math.min(
        distanceToNodePerimeter(startPt, srcNode),
        srcGroup
          ? distanceToNodePerimeter(startPt, {
              ...srcNode,
              shape: "rect",
              x: srcGroup.x,
              y: srcGroup.y,
              width: srcGroup.width,
              height: srcGroup.height
            })
          : Infinity
      );
      const dstDist = Math.min(
        distanceToNodePerimeter(endPt, dstNode),
        dstGroup
          ? distanceToNodePerimeter(endPt, {
              ...dstNode,
              shape: "rect",
              x: dstGroup.x,
              y: dstGroup.y,
              width: dstGroup.width,
              height: dstGroup.height
            })
          : Infinity
      );
      if (srcDist > 0.5) {
        violations.push(
          `Invariant 4 (source port perimeter): edge '${edge.id}' start (${startPt.x},${startPt.y}) is ${srcDist.toFixed(2)}px from '${srcNode.id}' perimeter (> 0.5px)`
        );
      }
      if (dstDist > 0.5) {
        violations.push(
          `Invariant 4 (target port perimeter): edge '${edge.id}' end (${endPt.x},${endPt.y}) is ${dstDist.toFixed(2)}px from '${dstNode.id}' perimeter (> 0.5px)`
        );
      }

      const p1 = edge.points[1]!;
      const stubStartLen = Math.hypot(p1.x - startPt.x, p1.y - startPt.y);
      const isStartOrthogonal =
        Math.abs(p1.x - startPt.x) < 0.1 || Math.abs(p1.y - startPt.y) < 0.1;
      if (!isStartOrthogonal || stubStartLen < 12 - 0.1) {
        violations.push(
          `Invariant 4 (source perpendicular stub): edge '${edge.id}' initial segment length=${stubStartLen.toFixed(2)}px orthogonal=${isStartOrthogonal}`
        );
      }

      const prevEnd = edge.points[edge.points.length - 2]!;
      const stubEndLen = Math.hypot(endPt.x - prevEnd.x, endPt.y - prevEnd.y);
      const isEndOrthogonal =
        Math.abs(endPt.x - prevEnd.x) < 0.1 || Math.abs(endPt.y - prevEnd.y) < 0.1;
      if (!isEndOrthogonal || stubEndLen < 12 - 0.1) {
        violations.push(
          `Invariant 4 (target perpendicular stub): edge '${edge.id}' terminal segment length=${stubEndLen.toFixed(2)}px orthogonal=${isEndOrthogonal}`
        );
      }

      if (edge.endMarker?.kind === "arrow") {
        const lastSeg = edge.segments[edge.segments.length - 1]!;
        const pullback = Math.hypot(endPt.x - lastSeg.x, endPt.y - lastSeg.y);
        if (Math.abs(pullback - 6.8) > 0.25) {
          violations.push(
            `Invariant 4 (arrow pullback): edge '${edge.id}' pullback is ${pullback.toFixed(2)}px (expected 6.8px)`
          );
        }
      }
    }
  }

  // 6. Edge-to-node non-intersection (no edge segment passes through any unrelated node box)
  if (scene.family !== "sequence") {
    for (const edge of scene.edges) {
      for (let k = 0; k + 1 < edge.points.length; k++) {
        const a = edge.points[k]!;
        const b = edge.points[k + 1]!;
        const segRect: Rect = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.max(1, Math.abs(b.x - a.x)),
          height: Math.max(1, Math.abs(b.y - a.y))
        };
        for (const node of scene.nodes) {
          if (node.id === edge.from || node.id === edge.to) continue;
          if (rectsIntersect(segRect, node, -2)) {
            violations.push(
              `Invariant 6 (edge-node intersection): edge "${edge.id}" (${edge.from}->${edge.to}) segment [${k}] intersects unrelated node "${node.id}"`
            );
          }
        }
      }
    }
  }

  // 5. ViewBox containment ([padding, viewBox.width - padding] x [padding, viewBox.height - padding])
  const pad = scene.padding;
  const maxX = scene.viewBox.width - pad;
  const maxY = scene.viewBox.height - pad;
  const checkBox = (label: string, r: Rect): void => {
    if (
      r.x < pad - 0.5 ||
      r.y < pad - 0.5 ||
      r.x + r.width > maxX + 0.5 ||
      r.y + r.height > maxY + 0.5
    ) {
      violations.push(
        `Invariant 5 (viewBox containment): ${label} (${r.x},${r.y},${r.width}x${r.height}) exceeds [${pad}, ${maxX}] x [${pad}, ${maxY}]`
      );
    }
  };

  for (const node of scene.nodes) checkBox(`node '${node.id}'`, node);
  for (const group of scene.groups) checkBox(`group '${group.id}'`, group);
  for (const note of scene.notes) checkBox(`note '${note.id}'`, note);
  for (const pill of allPills) checkBox(`pill '${pill.id}'`, pill.rect);

  return {
    ok: violations.length === 0,
    violations
  };
}
