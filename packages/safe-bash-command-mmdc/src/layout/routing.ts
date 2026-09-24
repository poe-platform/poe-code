import type {
  DocumentEdge,
  FlowDirection,
  MermaidThemeTokens,
  Point,
  Rect,
  SceneEdge,
  SceneGroup,
  SceneLabelPill,
  SceneMarker,
  SceneNode,
  SceneTextLine
} from "../contracts.js";
import {
  buildRoundedOrthogonalPath,
  pointOnNodePerimeter,
  rectsIntersect,
  type PortFace
} from "../geometry.js";
import { measureTextBlock } from "../text.js";

interface PortRequest {
  readonly edgeId: string;
  readonly endpoint: "source" | "target";
  readonly nodeId: string;
  readonly face: PortFace;
  readonly sortKey: number;
}

function hasDirectCorridorObstacle(
  src: SceneNode,
  dst: SceneNode,
  nodes: readonly SceneNode[],
  isHorizontal: boolean
): boolean {
  if (isHorizontal) {
    const gapStart = src.x < dst.x ? src.x + src.width : dst.x + dst.width;
    const gapEnd = src.x < dst.x ? dst.x : src.x;
    if (gapEnd - gapStart <= 24) return false;
    const bandTop = Math.min(src.y + src.height / 2, dst.y + dst.height / 2) - 14;
    const bandBottom = Math.max(src.y + src.height / 2, dst.y + dst.height / 2) + 14;
    const corridor: Rect = {
      x: gapStart + 8,
      y: bandTop,
      width: Math.max(1, gapEnd - gapStart - 16),
      height: Math.max(1, bandBottom - bandTop)
    };
    return nodes.some(
      (n) => n.id !== src.id && n.id !== dst.id && rectsIntersect(corridor, n, 0)
    );
  } else {
    const gapStart = src.y < dst.y ? src.y + src.height : dst.y + dst.height;
    const gapEnd = src.y < dst.y ? dst.y : src.y;
    if (gapEnd - gapStart <= 24) return false;
    const bandLeft = Math.min(src.x + src.width / 2, dst.x + dst.width / 2) - 14;
    const bandRight = Math.max(src.x + src.width / 2, dst.x + dst.width / 2) + 14;
    const corridor: Rect = {
      x: bandLeft,
      y: gapStart + 8,
      width: Math.max(1, bandRight - bandLeft),
      height: Math.max(1, gapEnd - gapStart - 16)
    };
    return nodes.some(
      (n) => n.id !== src.id && n.id !== dst.id && rectsIntersect(corridor, n, 0)
    );
  }
}

function countExitSideObstacles(
  src: SceneNode,
  dst: SceneNode,
  face: PortFace,
  nodes: readonly SceneNode[]
): number {
  let hits = 0;
  for (const endpoint of [src, dst]) {
    const cx = endpoint.x + endpoint.width / 2;
    const cy = endpoint.y + endpoint.height / 2;
    let ray: Rect;
    if (face === "top") {
      ray = { x: cx - 10, y: -10000, width: 20, height: Math.max(1, endpoint.y + 10000 - 2) };
    } else if (face === "bottom") {
      ray = { x: cx - 10, y: endpoint.y + endpoint.height + 2, width: 20, height: 20000 };
    } else if (face === "left") {
      ray = { x: -10000, y: cy - 10, width: Math.max(1, endpoint.x + 10000 - 2), height: 20 };
    } else {
      ray = { x: endpoint.x + endpoint.width + 2, y: cy - 10, width: 20000, height: 20 };
    }
    for (const n of nodes) {
      if (n.id === src.id || n.id === dst.id) continue;
      if (rectsIntersect(ray, n, 2)) hits++;
    }
  }
  return hits;
}

function isLElbowClear(
  src: SceneNode,
  dst: SceneNode,
  srcFace: PortFace,
  dstFace: PortFace,
  nodes: readonly SceneNode[]
): boolean {
  const srcPt = pointOnNodePerimeter(src, srcFace, 0).port;
  const dstPt = pointOnNodePerimeter(dst, dstFace, 0).port;
  const corner: Point =
    srcFace === "left" || srcFace === "right"
      ? { x: dstPt.x, y: srcPt.y }
      : { x: srcPt.x, y: dstPt.y };
  const leg1: Rect = {
    x: Math.min(srcPt.x, corner.x),
    y: Math.min(srcPt.y, corner.y),
    width: Math.max(1, Math.abs(corner.x - srcPt.x)),
    height: Math.max(1, Math.abs(corner.y - srcPt.y))
  };
  const leg2: Rect = {
    x: Math.min(corner.x, dstPt.x),
    y: Math.min(corner.y, dstPt.y),
    width: Math.max(1, Math.abs(dstPt.x - corner.x)),
    height: Math.max(1, Math.abs(dstPt.y - corner.y))
  };
  for (const n of nodes) {
    if (n.id === src.id || n.id === dst.id) continue;
    if (rectsIntersect(leg1, n, 8) || rectsIntersect(leg2, n, 8)) return false;
  }
  return true;
}

function choosePortFaces(
  src: SceneNode,
  dst: SceneNode,
  direction: FlowDirection,
  isSelfLoop: boolean,
  isBackEdge: boolean,
  backEdgeIndex: number,
  nodes: readonly SceneNode[],
  bypassCounter: number,
  srcOutDegree = 1
): { readonly srcFace: PortFace; readonly dstFace: PortFace; readonly isBypass: boolean } {
  if (isSelfLoop) {
    return direction === "LR" || direction === "RL"
      ? { srcFace: "top", dstFace: "top", isBypass: false }
      : { srcFace: "right", dstFace: "right", isBypass: false };
  }

  const isHorizontal = direction === "LR" || direction === "RL";
  const srcCx = src.x + src.width / 2;
  const srcCy = src.y + src.height / 2;
  const dstCx = dst.x + dst.width / 2;
  const dstCy = dst.y + dst.height / 2;

  if (isBackEdge) {
    if (isHorizontal) {
      const topHits = countExitSideObstacles(src, dst, "top", nodes);
      const bottomHits = countExitSideObstacles(src, dst, "bottom", nodes);
      if (topHits !== bottomHits) {
        const chosen: PortFace = bottomHits < topHits ? "bottom" : "top";
        return { srcFace: chosen, dstFace: chosen, isBypass: true };
      }
      const chosen: PortFace = backEdgeIndex % 2 === 0 ? "top" : "bottom";
      return { srcFace: chosen, dstFace: chosen, isBypass: true };
    }
    const rightHits = countExitSideObstacles(src, dst, "right", nodes);
    const leftHits = countExitSideObstacles(src, dst, "left", nodes);
    if (rightHits !== leftHits) {
      const chosen: PortFace = leftHits < rightHits ? "left" : "right";
      return { srcFace: chosen, dstFace: chosen, isBypass: true };
    }
    const chosen: PortFace = backEdgeIndex % 2 === 0 ? "right" : "left";
    return { srcFace: chosen, dstFace: chosen, isBypass: true };
  }

  // Check if an intermediate node sits directly in the corridor between src and dst
  if (hasDirectCorridorObstacle(src, dst, nodes, isHorizontal)) {
    if (isHorizontal) {
      const topHits = countExitSideObstacles(src, dst, "top", nodes);
      const bottomHits = countExitSideObstacles(src, dst, "bottom", nodes);
      const side: PortFace =
        bottomHits < topHits
          ? "bottom"
          : topHits < bottomHits
            ? "top"
            : bypassCounter % 2 === 0
              ? "bottom"
              : "top";
      return { srcFace: side, dstFace: side, isBypass: true };
    } else {
      const rightHits = countExitSideObstacles(src, dst, "right", nodes);
      const leftHits = countExitSideObstacles(src, dst, "left", nodes);
      const side: PortFace =
        rightHits < leftHits
          ? "right"
          : leftHits < rightHits
            ? "left"
            : bypassCounter % 2 === 0
              ? "right"
              : "left";
      return { srcFace: side, dstFace: side, isBypass: true };
    }
  }

  // Decision diamonds and multi-branching nodes exit cleanly from their side/top/bottom faces into an L-elbow when target center is laterally offset beyond the source bounds and the L-corridor is unobstructed
  if (src.shape === "diamond" || srcOutDegree >= 2) {
    const margin = src.shape === "diamond" ? 22 : 16;
    if (isHorizontal) {
      const targetFace: PortFace = dstCx >= srcCx ? "left" : "right";
      if (dstCy <= src.y - margin && isLElbowClear(src, dst, "top", targetFace, nodes)) {
        return { srcFace: "top", dstFace: targetFace, isBypass: false };
      }
      if (dstCy >= src.y + src.height + margin && isLElbowClear(src, dst, "bottom", targetFace, nodes)) {
        return { srcFace: "bottom", dstFace: targetFace, isBypass: false };
      }
    } else {
      const targetFace: PortFace = dstCy >= srcCy ? "top" : "bottom";
      if (dstCx <= src.x - margin && isLElbowClear(src, dst, "left", targetFace, nodes)) {
        return { srcFace: "left", dstFace: targetFace, isBypass: false };
      }
      if (dstCx >= src.x + src.width + margin && isLElbowClear(src, dst, "right", targetFace, nodes)) {
        return { srcFace: "right", dstFace: targetFace, isBypass: false };
      }
    }
  }

  if (isHorizontal) {
    if (Math.abs(dstCx - srcCx) >= 24) {
      return dstCx > srcCx
        ? { srcFace: "right", dstFace: "left", isBypass: false }
        : { srcFace: "left", dstFace: "right", isBypass: false };
    }
    return dstCy >= srcCy
      ? { srcFace: "bottom", dstFace: "top", isBypass: false }
      : { srcFace: "top", dstFace: "bottom", isBypass: false };
  } else {
    if (Math.abs(dstCy - srcCy) >= 24) {
      return dstCy > srcCy
        ? { srcFace: "bottom", dstFace: "top", isBypass: false }
        : { srcFace: "top", dstFace: "bottom", isBypass: false };
    }
    return dstCx >= srcCx
      ? { srcFace: "right", dstFace: "left", isBypass: false }
      : { srcFace: "left", dstFace: "right", isBypass: false };
  }
}

function buildLabelPill(
  rawText: string,
  center: Point,
  theme: MermaidThemeTokens
): SceneLabelPill {
  const isShortCard = rawText.length <= 4 && /^[0-9.*nN]+$/.test(rawText);
  const padX = isShortCard ? 8 : 9;
  const padY = isShortCard ? 3.5 : 3.5;
  const fSize = isShortCard ? 11 : theme.secondaryFontSize;
  const fFamily = "ui";
  const fWeight = isShortCard ? 600 : 500;
  const measured = measureTextBlock(rawText, {
    fontSize: fSize,
    lineHeight: 16,
    fontFamily: fFamily,
    fontWeight: fWeight
  });
  const width = Math.ceil(measured.width + padX * 2);
  const height = Math.ceil(measured.height + padY * 2);
  const x = Math.round(center.x - width / 2);
  const y = Math.round(center.y - height / 2);

  const lines: SceneTextLine[] = measured.lines.map((line, idx) => ({
    text: line.text,
    width: line.width,
    x: Math.round(x + width / 2),
    y: Math.round(y + padY + idx * 16 + (isShortCard ? 10.5 : 11.5)),
    fontSize: fSize,
    fontWeight: fWeight,
    fontFamily: fFamily,
    color: theme.text,
    align: "center"
  }));

  return {
    x,
    y,
    width,
    height,
    rx: isShortCard ? 4 : 5,
    fill: theme.edgeLabelBackground,
    stroke: theme.edgeLabelBorder,
    lines
  };
}

function findSafePillCenter(
  waypoints: readonly Point[],
  rawText: string,
  theme: MermaidThemeTokens,
  obstacles: readonly Rect[],
  placedPills: Rect[],
  otherEdgeSegments: readonly Rect[] = []
): SceneLabelPill {
  const segments: {
    readonly a: Point;
    readonly b: Point;
    readonly len: number;
    readonly index: number;
  }[] = [];
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    segments.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y), index: i });
  }
  const interior = segments.filter(
    (s) => s.index > 0 && s.index < segments.length - 1 && s.len >= 32
  );
  const pool = interior.length > 0 ? [...interior, ...segments] : [...segments];
  pool.sort((x, y) => y.len - x.len);

  const fractions = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8];
  const normalOffsets = [0, -16, 16, -28, 28, -42, 42, -56, 56];

  for (const seg of pool) {
    if (seg.len < 1) continue;
    const ux = (seg.b.x - seg.a.x) / seg.len;
    const uy = (seg.b.y - seg.a.y) / seg.len;
    const nx = -uy;
    const ny = ux;

    for (const nOff of normalOffsets) {
      for (const t of fractions) {
        const cx = seg.a.x + (seg.b.x - seg.a.x) * t + nx * nOff;
        const cy = seg.a.y + (seg.b.y - seg.a.y) * t + ny * nOff;
        const pill = buildLabelPill(rawText, { x: cx, y: cy }, theme);

        const collidesObstacle = obstacles.some((obs) => rectsIntersect(pill, obs, 4));
        const collidesPill = placedPills.some((prev) => rectsIntersect(pill, prev, 4));
        const collidesOtherEdge = otherEdgeSegments.some((segR) => rectsIntersect(pill, segR, 4));
        if (!collidesObstacle && !collidesPill && !collidesOtherEdge) {
          placedPills.push({ x: pill.x, y: pill.y, width: pill.width, height: pill.height });
          return pill;
        }
      }
    }
  }

  for (const seg of pool) {
    if (seg.len < 1) continue;
    for (const t of fractions) {
      const cx = seg.a.x + (seg.b.x - seg.a.x) * t;
      const cy = seg.a.y + (seg.b.y - seg.a.y) * t;
      const pill = buildLabelPill(rawText, { x: cx, y: cy }, theme);
      const collidesObstacle = obstacles.some((obs) => rectsIntersect(pill, obs, 2));
      const collidesPill = placedPills.some((prev) => rectsIntersect(pill, prev, 2));
      if (!collidesObstacle && !collidesPill) {
        placedPills.push({ x: pill.x, y: pill.y, width: pill.width, height: pill.height });
        return pill;
      }
    }
  }

  const bestSeg = pool[0] ?? {
    a: waypoints[0] ?? { x: 0, y: 0 },
    b: waypoints[waypoints.length - 1] ?? { x: 0, y: 0 }
  };
  const midPt = {
    x: (bestSeg.a.x + bestSeg.b.x) / 2,
    y: (bestSeg.a.y + bestSeg.b.y) / 2
  };
  for (let radius = 24; radius <= 220; radius += 16) {
    for (const [dx, dy] of [
      [0, -radius],
      [0, radius],
      [radius, 0],
      [-radius, 0],
      [radius, -radius],
      [-radius, -radius],
      [radius, radius],
      [-radius, radius]
    ] as const) {
      const candidate = buildLabelPill(rawText, { x: midPt.x + dx, y: midPt.y + dy }, theme);
      const collidesObstacle = obstacles.some((obs) => rectsIntersect(candidate, obs, 2));
      const collidesPill = placedPills.some((prev) => rectsIntersect(candidate, prev, 2));
      if (!collidesObstacle && !collidesPill) {
        placedPills.push({
          x: candidate.x,
          y: candidate.y,
          width: candidate.width,
          height: candidate.height
        });
        return candidate;
      }
    }
  }

  const fallback = buildLabelPill(rawText, midPt, theme);
  placedPills.push({
    x: fallback.x,
    y: fallback.y,
    width: fallback.width,
    height: fallback.height
  });
  return fallback;
}

function placeEndpointBadge(
  anchorPt: Point,
  adjPt: Point,
  rawText: string,
  theme: MermaidThemeTokens,
  obstacles: readonly Rect[],
  placedPills: Rect[],
  otherEdgeSegments: readonly Rect[]
): SceneLabelPill {
  const testPill = buildLabelPill(rawText, { x: 0, y: 0 }, theme);
  const dx = adjPt.x - anchorPt.x;
  const dy = adjPt.y - anchorPt.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const isVertical = Math.abs(dx) < 1;
  const baseNormalDist = Math.max(28, isVertical ? testPill.width / 2 + 12 : testPill.height / 2 + 12);
  const baseAlongDist = isVertical ? testPill.height / 2 + 4 : testPill.width / 2 + 6;

  for (const alongExtra of [0, 6, 12, 18]) {
    const along = Math.max(baseAlongDist, Math.min(Math.max(baseAlongDist, len - 4), baseAlongDist + alongExtra));
    for (const side of [-1, 1, -1.5, 1.5, -2.0, 2.0]) {
      const cx = anchorPt.x + ux * along + nx * (baseNormalDist * side);
      const cy = anchorPt.y + uy * along + ny * (baseNormalDist * side);
      const pill = buildLabelPill(rawText, { x: cx, y: cy }, theme);
      const collidesObstacle = obstacles.some((obs) => rectsIntersect(pill, obs, 4));
      const collidesPill = placedPills.some((prev) => rectsIntersect(pill, prev, 4));
      const collidesOtherEdge = otherEdgeSegments.some((segR) => rectsIntersect(pill, segR, 4));
      if (!collidesObstacle && !collidesPill && !collidesOtherEdge) {
        placedPills.push({ x: pill.x, y: pill.y, width: pill.width, height: pill.height });
        return pill;
      }
    }
  }
  return findSafePillCenter([anchorPt, adjPt], rawText, theme, obstacles, placedPills, otherEdgeSegments);
}

function firstBlockingNode(
  pts: readonly Point[],
  srcId: string,
  dstId: string,
  nodes: readonly SceneNode[]
): { readonly segIndex: number; readonly node: SceneNode } | undefined {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const segRect: Rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.max(1, Math.abs(b.x - a.x)),
      height: Math.max(1, Math.abs(b.y - a.y))
    };
    for (const node of nodes) {
      if (node.id === srcId || node.id === dstId) continue;
      if (rectsIntersect(segRect, node, 4)) {
        return { segIndex: k, node };
      }
    }
  }
  return undefined;
}

function detourAroundBlockingNodes(
  initialWaypoints: Point[],
  src: SceneNode,
  dst: SceneNode,
  srcAttach: { readonly port: Point; readonly stubPoint: Point },
  dstAttach: { readonly port: Point; readonly stubPoint: Point },
  nodes: readonly SceneNode[],
  laneOffset: number
): Point[] {
  let pts = [...initialWaypoints];
  for (let attempt = 0; attempt < 6; attempt++) {
    const hit = firstBlockingNode(pts, src.id, dst.id, nodes);
    if (!hit) return pts;

    const a = pts[hit.segIndex]!;
    const b = pts[hit.segIndex + 1]!;
    const obs = hit.node;
    const isVertSeg = Math.abs(a.x - b.x) < 1;

    if (isVertSeg) {
      // Vertical segment [a, b] hits obs. Detour left or right around all nodes in that Y range.
      const minY = Math.min(a.y, b.y) - 12;
      const maxY = Math.max(a.y, b.y) + 12;
      const cluster = nodes.filter(
        (n) =>
          n.id !== src.id &&
          n.id !== dst.id &&
          n.y + n.height >= minY &&
          n.y <= maxY &&
          Math.abs(n.x + n.width / 2 - a.x) <= Math.max(n.width, 220)
      );
      const rightEdge = Math.max(obs.x + obs.width, ...cluster.map((c) => c.x + c.width)) + 28 + laneOffset;
      const leftEdge = Math.min(obs.x, ...cluster.map((c) => c.x)) - 28 - laneOffset;
      const goRight = Math.abs(rightEdge - a.x) <= Math.abs(a.x - leftEdge);
      const detourX = Math.round(goRight ? rightEdge : leftEdge);

      const enterY = a.y <= b.y ? Math.max(Math.min(a.y, b.y), obs.y - 18) : Math.min(Math.max(a.y, b.y), obs.y + obs.height + 18);
      const exitY = a.y <= b.y ? Math.min(Math.max(a.y, b.y), obs.y + obs.height + 18) : Math.max(Math.min(a.y, b.y), obs.y - 18);

      // If this is a 4-point Z-path [port0, (x0, midY), (x1, midY), port1], shift midY or route via detourX
      if (pts.length === 4 && (hit.segIndex === 0 || hit.segIndex === 2)) {
        pts = [
          srcAttach.port,
          srcAttach.stubPoint,
          { x: detourX, y: srcAttach.stubPoint.y },
          { x: detourX, y: dstAttach.stubPoint.y },
          dstAttach.stubPoint,
          dstAttach.port
        ];
      } else {
        const prefix = pts.slice(0, hit.segIndex + 1);
        const suffix = pts.slice(hit.segIndex + 1);
        pts = [
          ...prefix,
          { x: a.x, y: enterY },
          { x: detourX, y: enterY },
          { x: detourX, y: exitY },
          { x: b.x, y: exitY },
          ...suffix
        ];
      }
    } else {
      // Horizontal segment [a, b] hits obs. Detour above or below obs.
      const minX = Math.min(a.x, b.x) - 12;
      const maxX = Math.max(a.x, b.x) + 12;
      const cluster = nodes.filter(
        (n) =>
          n.id !== src.id &&
          n.id !== dst.id &&
          n.x + n.width >= minX &&
          n.x <= maxX &&
          Math.abs(n.y + n.height / 2 - a.y) <= Math.max(n.height, 160)
      );
      const bottomEdge = Math.max(obs.y + obs.height, ...cluster.map((c) => c.y + c.height)) + 24 + laneOffset;
      const topEdge = Math.min(obs.y, ...cluster.map((c) => c.y)) - 24 - laneOffset;
      const goDown = Math.abs(bottomEdge - a.y) <= Math.abs(a.y - topEdge);
      const detourY = Math.round(goDown ? bottomEdge : topEdge);

      if (pts.length === 4 && hit.segIndex === 1) {
        pts = [
          pts[0]!,
          { x: pts[0]!.x, y: detourY },
          { x: pts[3]!.x, y: detourY },
          pts[3]!
        ];
      } else {
        const enterX = a.x <= b.x ? Math.max(Math.min(a.x, b.x), obs.x - 18) : Math.min(Math.max(a.x, b.x), obs.x + obs.width + 18);
        const exitX = a.x <= b.x ? Math.min(Math.max(a.x, b.x), obs.x + obs.width + 18) : Math.max(Math.min(a.x, b.x), obs.x - 18);
        const prefix = pts.slice(0, hit.segIndex + 1);
        const suffix = pts.slice(hit.segIndex + 1);
        pts = [
          ...prefix,
          { x: enterX, y: a.y },
          { x: enterX, y: detourY },
          { x: exitX, y: detourY },
          { x: exitX, y: b.y },
          ...suffix
        ];
      }
    }
  }
  return pts;
}

export function routeGraphEdges(
  edges: readonly DocumentEdge[],
  nodes: readonly SceneNode[],
  groups: readonly SceneGroup[],
  direction: FlowDirection,
  theme: MermaidThemeTokens,
  nodeRanks: ReadonlyMap<string, number>
): readonly SceneEdge[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const hasInternalOutgoing = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const u = nodeById.get(e.from);
    const v = nodeById.get(e.to);
    if (u?.groupId && u.groupId === v?.groupId) {
      hasInternalOutgoing.add(u.id);
    }
  }

  const obstacles: Rect[] = [
    ...nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
    ...groups
      .filter((g) => g.kind !== "sequenceBlock")
      .map((g) => ({ x: g.x, y: g.y, width: g.width, height: g.headerHeight }))
  ];

  const faceBuckets = new Map<string, PortRequest[]>();
  const edgeMeta = new Map<
    string,
    {
      readonly srcFace: PortFace;
      readonly dstFace: PortFace;
      readonly isSelfLoop: boolean;
      readonly isBackEdge: boolean;
      readonly isBypass: boolean;
      readonly backEdgeIndex: number;
      readonly bypassIndex: number;
      readonly pairIndex: number;
      readonly pairTotal: number;
    }
  >();

  const outDegree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
  }
  const pairTotals = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const pairKey =
      edge.from < edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
    pairTotals.set(pairKey, (pairTotals.get(pairKey) ?? 0) + 1);
  }

  const pairCounts = new Map<string, number>();
  let backEdgeCounter = 0;
  let bypassCounter = 0;

  for (const edge of edges) {
    const src = nodeById.get(edge.from);
    const dst = nodeById.get(edge.to);
    if (!src || !dst) continue;

    const isSelfLoop = edge.from === edge.to;
    const rSrc = nodeRanks.get(edge.from) ?? 0;
    const rDst = nodeRanks.get(edge.to) ?? 0;
    const isReverseFlow = direction === "BT" || direction === "RL";
    const isBackEdge = !isSelfLoop && (isReverseFlow ? rSrc < rDst : rSrc > rDst);
    const currentBackIdx = isBackEdge ? backEdgeCounter++ : 0;

    const pairKey =
      edge.from < edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
    const pairIndex = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, pairIndex + 1);
    const pairTotal = isSelfLoop ? 1 : (pairTotals.get(pairKey) ?? 1);

    const { srcFace, dstFace, isBypass } = choosePortFaces(
      src,
      dst,
      direction,
      isSelfLoop,
      isBackEdge,
      currentBackIdx,
      nodes,
      bypassCounter,
      outDegree.get(edge.from) ?? 1
    );
    const currentBypassIdx = isBypass ? bypassCounter++ : 0;

    edgeMeta.set(edge.id, {
      srcFace,
      dstFace,
      isSelfLoop,
      isBackEdge,
      isBypass,
      backEdgeIndex: currentBackIdx,
      bypassIndex: currentBypassIdx,
      pairIndex,
      pairTotal
    });

    const srcSortKey =
      srcFace === "top" || srcFace === "bottom"
        ? dst.x + dst.width / 2 + pairIndex * 36
        : dst.y + dst.height / 2 + pairIndex * 36;
    const dstSortKey =
      dstFace === "top" || dstFace === "bottom"
        ? src.x + src.width / 2 + pairIndex * 36
        : src.y + src.height / 2 + pairIndex * 36;

    const srcBucketKey = `${src.id}:${srcFace}`;
    const dstBucketKey = `${dst.id}:${dstFace}`;
    const srcList = faceBuckets.get(srcBucketKey) ?? [];
    srcList.push({
      edgeId: edge.id,
      endpoint: "source",
      nodeId: src.id,
      face: srcFace,
      sortKey: srcSortKey
    });
    faceBuckets.set(srcBucketKey, srcList);

    const dstList = faceBuckets.get(dstBucketKey) ?? [];
    dstList.push({
      edgeId: edge.id,
      endpoint: "target",
      nodeId: dst.id,
      face: dstFace,
      sortKey: dstSortKey
    });
    faceBuckets.set(dstBucketKey, dstList);
  }

  const assignedOffsets = new Map<string, number>();
  for (const [, requests] of faceBuckets) {
    requests.sort((a, b) => a.sortKey - b.sortKey);
    const count = requests.length;
    const hasParallel = requests.some((r) => (edgeMeta.get(r.edgeId)?.pairTotal ?? 1) > 1);
    const isSelfLoopFace = requests.some((r) => edgeMeta.get(r.edgeId)?.isSelfLoop === true);
    const spacing = hasParallel ? 42 : isSelfLoopFace ? 44 : 16;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * spacing;
      assignedOffsets.set(`${requests[i]!.edgeId}:${requests[i]!.endpoint}`, offset);
    }
  }

  let maxRight = 0;
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxBottom = 0;
  for (const n of nodes) {
    if (n.x + n.width > maxRight) maxRight = n.x + n.width;
    if (n.x < minLeft) minLeft = n.x;
    if (n.y < minTop) minTop = n.y;
    if (n.y + n.height > maxBottom) maxBottom = n.y + n.height;
  }
  for (const g of groups) {
    if (g.x + g.width > maxRight) maxRight = g.x + g.width;
    if (g.x < minLeft) minLeft = g.x;
    if (g.y < minTop) minTop = g.y;
    if (g.y + g.height > maxBottom) maxBottom = g.y + g.height;
  }

  const placedPills: Rect[] = [];
  const sideLaneCounts = new Map<PortFace, number>();
  const routedDrafts: {
    readonly edge: DocumentEdge;
    readonly built: ReturnType<typeof buildRoundedOrthogonalPath>;
    readonly startMarker: SceneMarker | undefined;
    readonly endMarker: SceneMarker | undefined;
    readonly srcAttach: { readonly port: Point; readonly stubPoint: Point; readonly normal: Point };
    readonly dstAttach: { readonly port: Point; readonly stubPoint: Point; readonly normal: Point };
  }[] = [];
  const sceneEdges: SceneEdge[] = [];

  for (const edge of edges) {
    const src = nodeById.get(edge.from);
    const dst = nodeById.get(edge.to);
    const meta = edgeMeta.get(edge.id);
    if (!src || !dst || !meta) continue;

    const srcOff = assignedOffsets.get(`${edge.id}:source`) ?? 0;
    const dstOff = assignedOffsets.get(`${edge.id}:target`) ?? 0;
    let srcAttach = pointOnNodePerimeter(src, meta.srcFace, srcOff);
    let dstAttach = pointOnNodePerimeter(dst, meta.dstFace, dstOff);

    // Anchor compositeState entry/exit transitions directly on the outer perimeter of the compositeState box
    const srcStateGroup = src.groupId ? groupById.get(src.groupId) : undefined;
    let effSrcFace = meta.srcFace;
    let effDstFace = meta.dstFace;
    if (
      srcStateGroup?.kind === "compositeState" &&
      src.groupId !== dst.groupId &&
      !hasInternalOutgoing.has(src.id)
    ) {
      if (
        (direction === "LR" || direction === "RL") &&
        dst.x >= srcStateGroup.x + srcStateGroup.width + 24
      ) {
        effSrcFace = "right";
        effDstFace = "left";
        dstAttach = pointOnNodePerimeter(dst, "left", dstOff);
      } else if (
        (direction === "LR" || direction === "RL") &&
        dst.x + dst.width <= srcStateGroup.x - 24
      ) {
        effSrcFace = "left";
        effDstFace = "right";
        dstAttach = pointOnNodePerimeter(dst, "right", dstOff);
      } else if (
        (direction === "TD" || direction === "BT") &&
        dst.y >= srcStateGroup.y + srcStateGroup.height + 24
      ) {
        effSrcFace = "bottom";
        effDstFace = "top";
        dstAttach = pointOnNodePerimeter(dst, "top", dstOff);
      }
      const gx =
        effSrcFace === "left"
          ? srcStateGroup.x
          : effSrcFace === "right"
            ? srcStateGroup.x + srcStateGroup.width
            : srcAttach.port.x;
      const gy =
        effSrcFace === "top"
          ? srcStateGroup.y
          : effSrcFace === "bottom"
            ? srcStateGroup.y + srcStateGroup.height
            : srcAttach.port.y;
      const port = { x: gx, y: gy };
      const norm =
        effSrcFace === "left"
          ? { x: -1, y: 0 }
          : effSrcFace === "right"
            ? { x: 1, y: 0 }
            : effSrcFace === "top"
              ? { x: 0, y: -1 }
              : { x: 0, y: 1 };
      srcAttach = {
        port,
        stubPoint: {
          x: port.x + norm.x * 16,
          y: port.y + norm.y * 16
        },
        normal: norm
      };
    }

    const dstStateGroup = dst.groupId ? groupById.get(dst.groupId) : undefined;
    if (
      dstStateGroup?.kind === "compositeState" &&
      dst.groupId !== src.groupId &&
      dst.shape === "stateStart"
    ) {
      const gx =
        meta.dstFace === "left"
          ? dstStateGroup.x
          : meta.dstFace === "right"
            ? dstStateGroup.x + dstStateGroup.width
            : dstAttach.port.x;
      const gy =
        meta.dstFace === "top"
          ? dstStateGroup.y
          : meta.dstFace === "bottom"
            ? dstStateGroup.y + dstStateGroup.height
            : dstAttach.port.y;
      const port = { x: gx, y: gy };
      dstAttach = {
        port,
        stubPoint: {
          x: port.x + dstAttach.normal.x * 16,
          y: port.y + dstAttach.normal.y * 16
        },
        normal: dstAttach.normal
      };
    }

    let waypoints: Point[];

    if (meta.isSelfLoop) {
      const loopOut = 38 + meta.pairIndex * 20;
      if (meta.srcFace === "top" && meta.dstFace === "top") {
        const topY = src.y - loopOut;
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: topY },
          { x: dstAttach.port.x, y: topY },
          dstAttach.port
        ];
      } else {
        const rightX = src.x + src.width + loopOut;
        waypoints = [
          srcAttach.port,
          { x: rightX, y: srcAttach.port.y },
          { x: rightX, y: dstAttach.port.y },
          dstAttach.port
        ];
      }
    } else if (meta.isBackEdge || meta.isBypass || meta.srcFace === meta.dstFace) {
      const prevLane = sideLaneCounts.get(meta.srcFace) ?? 0;
      const laneNum = prevLane + 1;
      sideLaneCounts.set(meta.srcFace, laneNum);
      const spanMinY = Math.min(src.y, dst.y) - 12;
      const spanMaxY = Math.max(src.y + src.height, dst.y + dst.height) + 12;
      const spanMinX = Math.min(src.x, dst.x) - 12;
      const spanMaxX = Math.max(src.x + src.width, dst.x + dst.width) + 12;

      if (meta.srcFace === "top" && meta.dstFace === "top") {
        const localTop = Math.min(
          srcAttach.stubPoint.y,
          dstAttach.stubPoint.y,
          ...nodes
            .filter((n) => n.x + n.width >= spanMinX && n.x <= spanMaxX)
            .map((n) => n.y),
          ...groups
            .filter((g) => g.x + g.width >= spanMinX && g.x <= spanMaxX)
            .map((g) => g.y)
        );
        const corridorY = Math.min(localTop, meta.isBackEdge ? minTop : localTop) - 26 - 42 * (laneNum - 1);
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: corridorY },
          { x: dstAttach.port.x, y: corridorY },
          dstAttach.port
        ];
      } else if (meta.srcFace === "bottom" && meta.dstFace === "bottom") {
        const localBottom = Math.max(
          srcAttach.stubPoint.y,
          dstAttach.stubPoint.y,
          ...nodes
            .filter((n) => n.x + n.width >= spanMinX && n.x <= spanMaxX)
            .map((n) => n.y + n.height),
          ...groups
            .filter((g) => g.x + g.width >= spanMinX && g.x <= spanMaxX)
            .map((g) => g.y + g.height)
        );
        const corridorY = Math.max(localBottom, meta.isBackEdge ? maxBottom : localBottom) + 26 + 42 * (laneNum - 1);
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: corridorY },
          { x: dstAttach.port.x, y: corridorY },
          dstAttach.port
        ];
      } else if (meta.srcFace === "right" && meta.dstFace === "right") {
        const localRight = Math.max(
          srcAttach.stubPoint.x,
          dstAttach.stubPoint.x,
          ...nodes
            .filter((n) => n.y + n.height >= spanMinY && n.y <= spanMaxY)
            .map((n) => n.x + n.width),
          ...groups
            .filter((g) => g.y + g.height >= spanMinY && g.y <= spanMaxY)
            .map((g) => g.x + g.width)
        );
        const corridorX = Math.max(localRight, meta.isBackEdge ? maxRight : localRight) + 28 + 48 * (laneNum - 1);
        waypoints = [
          srcAttach.port,
          { x: corridorX, y: srcAttach.port.y },
          { x: corridorX, y: dstAttach.port.y },
          dstAttach.port
        ];
      } else {
        const localLeft = Math.min(
          srcAttach.stubPoint.x,
          dstAttach.stubPoint.x,
          ...nodes
            .filter((n) => n.y + n.height >= spanMinY && n.y <= spanMaxY)
            .map((n) => n.x),
          ...groups
            .filter((g) => g.y + g.height >= spanMinY && g.y <= spanMaxY)
            .map((g) => g.x)
        );
        const corridorX = Math.min(localLeft, meta.isBackEdge ? minLeft : localLeft) - 28 - 48 * (laneNum - 1);
        waypoints = [
          srcAttach.port,
          { x: corridorX, y: srcAttach.port.y },
          { x: corridorX, y: dstAttach.port.y },
          dstAttach.port
        ];
      }
    } else if (
      (effSrcFace === "left" || effSrcFace === "right") &&
      (effDstFace === "top" || effDstFace === "bottom")
    ) {
      waypoints = [
        srcAttach.port,
        { x: dstAttach.port.x, y: srcAttach.port.y },
        dstAttach.port
      ];
    } else if (
      (effSrcFace === "top" || effSrcFace === "bottom") &&
      (effDstFace === "left" || effDstFace === "right")
    ) {
      waypoints = [
        srcAttach.port,
        { x: srcAttach.port.x, y: dstAttach.port.y },
        dstAttach.port
      ];
    } else if (effSrcFace === "bottom" && effDstFace === "top") {
      let lowY = srcAttach.stubPoint.y;
      let highY = dstAttach.stubPoint.y;
      if (src.groupId && src.groupId !== dst.groupId) {
        const srcGroup = groups.find((g) => g.id === src.groupId);
        if (srcGroup && srcGroup.y + srcGroup.height < highY) {
          lowY = Math.max(lowY, srcGroup.y + srcGroup.height + 10);
        }
      }
      if (dst.groupId && dst.groupId !== src.groupId) {
        const dstGroup = groups.find((g) => g.id === dst.groupId);
        if (dstGroup && dstGroup.y > lowY) {
          highY = Math.min(highY, dstGroup.y - 10);
        }
      }
      const midY = Math.round((lowY + highY) / 2);

      if (Math.abs(srcAttach.port.x - dstAttach.port.x) <= 4 && meta.pairTotal === 1) {
        const sharedX =
          dst.shape === "diamond"
            ? dstAttach.port.x
            : src.shape === "diamond"
              ? srcAttach.port.x
              : Math.round((srcAttach.port.x + dstAttach.port.x) / 2);
        waypoints = [
          { x: sharedX, y: srcAttach.port.y },
          { x: sharedX, y: dstAttach.port.y }
        ];
      } else {
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: midY },
          { x: dstAttach.port.x, y: midY },
          dstAttach.port
        ];
      }
    } else if (effSrcFace === "top" && effDstFace === "bottom") {
      const midY = Math.round((srcAttach.stubPoint.y + dstAttach.stubPoint.y) / 2);
      if (Math.abs(srcAttach.port.x - dstAttach.port.x) <= 4 && meta.pairTotal === 1) {
        const sharedX =
          dst.shape === "diamond"
            ? dstAttach.port.x
            : src.shape === "diamond"
              ? srcAttach.port.x
              : Math.round((srcAttach.port.x + dstAttach.port.x) / 2);
        waypoints = [
          { x: sharedX, y: srcAttach.port.y },
          { x: sharedX, y: dstAttach.port.y }
        ];
      } else {
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: midY },
          { x: dstAttach.port.x, y: midY },
          dstAttach.port
        ];
      }
    } else if (
      (effSrcFace === "right" && effDstFace === "left") ||
      (effSrcFace === "left" && effDstFace === "right")
    ) {
      const midX = Math.round((srcAttach.stubPoint.x + dstAttach.stubPoint.x) / 2);
      if (Math.abs(srcAttach.port.y - dstAttach.port.y) <= 4 && meta.pairTotal === 1) {
        const sharedY =
          dst.shape === "diamond"
            ? dstAttach.port.y
            : src.shape === "diamond"
              ? srcAttach.port.y
              : Math.round((srcAttach.port.y + dstAttach.port.y) / 2);
        waypoints = [
          { x: srcAttach.port.x, y: sharedY },
          { x: dstAttach.port.x, y: sharedY }
        ];
      } else {
        waypoints = [
          srcAttach.port,
          { x: midX, y: srcAttach.port.y },
          { x: midX, y: dstAttach.port.y },
          dstAttach.port
        ];
      }
    } else {
      waypoints = [
        srcAttach.port,
        srcAttach.stubPoint,
        { x: dstAttach.stubPoint.x, y: srcAttach.stubPoint.y },
        dstAttach.stubPoint,
        dstAttach.port
      ];
    }

    if (!meta.isSelfLoop) {
      waypoints = detourAroundBlockingNodes(
        waypoints,
        src,
        dst,
        srcAttach,
        dstAttach,
        nodes,
        meta.bypassIndex * 16
      );
    }

    const built = buildRoundedOrthogonalPath(
      waypoints,
      theme.elbowRadius,
      edge.startMarker,
      edge.endMarker
    );

    const p0 = built.points[0]!;
    const p1 = built.points[1]!;
    const pn = built.points[built.points.length - 1]!;
    const pnPrev = built.points[built.points.length - 2]!;

    const startMarker: SceneMarker | undefined =
      edge.startMarker !== "none"
        ? {
            kind: edge.startMarker,
            tip: p0,
            angleRadians: Math.atan2(p0.y - p1.y, p0.x - p1.x),
            stroke: theme.edge,
            fill:
              edge.startMarker === "umlHollowTriangle" ||
              edge.startMarker === "umlAggregation" ||
              edge.startMarker === "erZeroOrOne" ||
              edge.startMarker === "erZeroOrMore"
                ? theme.canvas
                : theme.edge
          }
        : undefined;

    const endMarker: SceneMarker | undefined =
      edge.endMarker !== "none"
        ? {
            kind: edge.endMarker,
            tip: pn,
            angleRadians: Math.atan2(pn.y - pnPrev.y, pn.x - pnPrev.x),
            stroke: theme.edge,
            fill:
              edge.endMarker === "umlHollowTriangle" ||
              edge.endMarker === "umlAggregation" ||
              edge.endMarker === "erZeroOrOne" ||
              edge.endMarker === "erZeroOrMore"
                ? theme.canvas
                : theme.edge
          }
        : undefined;

    routedDrafts.push({ edge, built, startMarker, endMarker, srcAttach, dstAttach });
  }

  for (const draft of routedDrafts) {
    const { edge, built, startMarker, endMarker, srcAttach, dstAttach } = draft;
    const otherEdgeSegments: Rect[] = [];
    for (const other of routedDrafts) {
      if (other.edge.id === edge.id) continue;
      for (let k = 0; k + 1 < other.built.points.length; k++) {
        const a = other.built.points[k]!;
        const b = other.built.points[k + 1]!;
        otherEdgeSegments.push({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.max(1, Math.abs(b.x - a.x)),
          height: Math.max(1, Math.abs(b.y - a.y))
        });
      }
    }

    const labelPill =
      edge.label !== undefined && edge.label.trim().length > 0
        ? findSafePillCenter(built.points, edge.label, theme, obstacles, placedPills, otherEdgeSegments)
        : undefined;

    const sourceLabelPill =
      edge.sourceLabel !== undefined && edge.sourceLabel.trim().length > 0
        ? placeEndpointBadge(
            built.points[0]!,
            built.points[1]!,
            edge.sourceLabel,
            theme,
            obstacles,
            placedPills,
            otherEdgeSegments
          )
        : undefined;

    const targetLabelPill =
      edge.targetLabel !== undefined && edge.targetLabel.trim().length > 0
        ? placeEndpointBadge(
            built.points[built.points.length - 1]!,
            built.points[built.points.length - 2]!,
            edge.targetLabel,
            theme,
            obstacles,
            placedPills,
            otherEdgeSegments
          )
        : undefined;

    sceneEdges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      lineStyle: edge.lineStyle,
      stroke: theme.edge,
      strokeWidth: edge.lineStyle === "thick" ? theme.strokeWidth + 1 : theme.strokeWidth,
      points: built.points,
      segments: built.segments,
      d: built.d,
      startMarker,
      endMarker,
      labelPill,
      sourceLabelPill,
      targetLabelPill,
      sourcePort: srcAttach.port,
      targetPort: dstAttach.port,
      sourceNormal: srcAttach.normal,
      targetNormal: dstAttach.normal
    });
  }

  return sceneEdges;
}
