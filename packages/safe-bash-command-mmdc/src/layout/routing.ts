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

function choosePortFaces(
  src: SceneNode,
  dst: SceneNode,
  direction: FlowDirection,
  isSelfLoop: boolean,
  isBackEdge: boolean
): { readonly srcFace: PortFace; readonly dstFace: PortFace } {
  if (isSelfLoop) {
    return direction === "LR" || direction === "RL"
      ? { srcFace: "top", dstFace: "right" }
      : { srcFace: "right", dstFace: "top" };
  }

  const isHorizontal = direction === "LR" || direction === "RL";
  const srcCx = src.x + src.width / 2;
  const srcCy = src.y + src.height / 2;
  const dstCx = dst.x + dst.width / 2;
  const dstCy = dst.y + dst.height / 2;

  if (isBackEdge) {
    if (isHorizontal) {
      return { srcFace: "top", dstFace: "top" };
    }
    return { srcFace: "right", dstFace: "right" };
  }

  if (isHorizontal) {
    if (Math.abs(dstCx - srcCx) >= 24) {
      return dstCx > srcCx
        ? { srcFace: "right", dstFace: "left" }
        : { srcFace: "left", dstFace: "right" };
    }
    return dstCy >= srcCy
      ? { srcFace: "bottom", dstFace: "top" }
      : { srcFace: "top", dstFace: "bottom" };
  } else {
    if (Math.abs(dstCy - srcCy) >= 24) {
      return dstCy > srcCy
        ? { srcFace: "bottom", dstFace: "top" }
        : { srcFace: "top", dstFace: "bottom" };
    }
    return dstCx >= srcCx
      ? { srcFace: "right", dstFace: "left" }
      : { srcFace: "left", dstFace: "right" };
  }
}

function buildLabelPill(
  rawText: string,
  center: Point,
  theme: MermaidThemeTokens
): SceneLabelPill {
  const measured = measureTextBlock(rawText, {
    fontSize: theme.secondaryFontSize,
    lineHeight: 16,
    fontFamily: "ui",
    fontWeight: 500
  });
  const padX = 14;
  const padY = 6;
  const width = Math.ceil(measured.width + padX * 2);
  const height = Math.ceil(measured.height + padY * 2);
  const x = Math.round(center.x - width / 2);
  const y = Math.round(center.y - height / 2);

  const lines: SceneTextLine[] = measured.lines.map((line, idx) => ({
    text: line.text,
    width: line.width,
    x: Math.round(x + width / 2),
    y: Math.round(y + padY + idx * 16 + 11.5),
    fontSize: theme.secondaryFontSize,
    fontWeight: 500,
    fontFamily: "ui",
    color: theme.text,
    align: "center"
  }));

  return {
    x,
    y,
    width,
    height,
    rx: 6,
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
  placedPills: Rect[]
): SceneLabelPill {
  // Rank straight segments by length (prefer interior routing segments first)
  const candidates: { p0: Point; p1: Point; length: number; priority: number }[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p0 = waypoints[i]!;
    const p1 = waypoints[i + 1]!;
    const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const isInterior = i > 0 && i < waypoints.length - 2;
    candidates.push({
      p0,
      p1,
      length,
      priority: (isInterior ? 1000 : 0) + length
    });
  }
  candidates.sort((a, b) => b.priority - a.priority);

  const sampleFractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75];
  const normalOffsets = [0, -18, 18, -32, 32, -48, 48];

  for (const seg of candidates) {
    const dx = seg.p1.x - seg.p0.x;
    const dy = seg.p1.y - seg.p0.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;

    for (const offset of normalOffsets) {
      for (const t of sampleFractions) {
        const cx = seg.p0.x + dx * t + nx * offset;
        const cy = seg.p0.y + dy * t + ny * offset;
        const pill = buildLabelPill(rawText, { x: cx, y: cy }, theme);
        const collidesObstacle = obstacles.some((obs) => rectsIntersect(pill, obs, 4));
        const collidesPill = placedPills.some((prev) => rectsIntersect(pill, prev, 4));
        if (!collidesObstacle && !collidesPill) {
          placedPills.push({ x: pill.x, y: pill.y, width: pill.width, height: pill.height });
          return pill;
        }
      }
    }
  }

  // Fallback: spiral search around midpoint of longest segment so collision is strictly impossible
  const primary = candidates[0] ?? { p0: { x: 100, y: 100 }, p1: { x: 100, y: 100 } };
  const midX = (primary.p0.x + primary.p1.x) / 2;
  const midY = (primary.p0.y + primary.p1.y) / 2;
  for (let radius = 16; radius <= 320; radius += 16) {
    for (const [ox, oy] of [
      [0, -radius],
      [0, radius],
      [radius, 0],
      [-radius, 0],
      [radius, -radius],
      [-radius, -radius],
      [radius, radius],
      [-radius, radius]
    ] as const) {
      const pill = buildLabelPill(rawText, { x: midX + ox, y: midY + oy }, theme);
      const collidesObstacle = obstacles.some((obs) => rectsIntersect(pill, obs, 3));
      const collidesPill = placedPills.some((prev) => rectsIntersect(pill, prev, 3));
      if (!collidesObstacle && !collidesPill) {
        placedPills.push({ x: pill.x, y: pill.y, width: pill.width, height: pill.height });
        return pill;
      }
    }
  }

  const fallback = buildLabelPill(rawText, { x: midX, y: midY }, theme);
  placedPills.push({ x: fallback.x, y: fallback.y, width: fallback.width, height: fallback.height });
  return fallback;
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
  const isHorizontal = direction === "LR" || direction === "RL";

  // Obstacles include all node boxes and all 32px subgraph header bands
  const obstacles: Rect[] = [
    ...nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
    ...groups
      .filter((g) => g.kind !== "sequenceBlock")
      .map((g) => ({ x: g.x, y: g.y, width: g.width, height: g.headerHeight }))
  ];

  // Collect port requests per (nodeId, face)
  const faceBuckets = new Map<string, PortRequest[]>();
  const edgeMeta = new Map<
    string,
    {
      readonly srcFace: PortFace;
      readonly dstFace: PortFace;
      readonly isSelfLoop: boolean;
      readonly isBackEdge: boolean;
      readonly pairIndex: number;
    }
  >();

  const pairCounts = new Map<string, number>();

  for (const edge of edges) {
    const src = nodeById.get(edge.from);
    const dst = nodeById.get(edge.to);
    if (!src || !dst) continue;

    const isSelfLoop = edge.from === edge.to;
    const rSrc = nodeRanks.get(edge.from) ?? 0;
    const rDst = nodeRanks.get(edge.to) ?? 0;
    const isBackEdge = !isSelfLoop && rSrc > rDst;

    const pairKey =
      edge.from < edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
    const pairIndex = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, pairIndex + 1);

    const { srcFace, dstFace } = choosePortFaces(
      src,
      dst,
      direction,
      isSelfLoop,
      isBackEdge
    );
    edgeMeta.set(edge.id, { srcFace, dstFace, isSelfLoop, isBackEdge, pairIndex });

    const srcSortKey =
      srcFace === "top" || srcFace === "bottom"
        ? dst.x + dst.width / 2 + pairIndex * 24
        : dst.y + dst.height / 2 + pairIndex * 24;
    const dstSortKey =
      dstFace === "top" || dstFace === "bottom"
        ? src.x + src.width / 2 + pairIndex * 24
        : src.y + src.height / 2 + pairIndex * 24;

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

  // Distribute ports along each face with >= 14px spacing centered on face midpoint
  const assignedOffsets = new Map<string, number>();
  for (const [, requests] of faceBuckets) {
    requests.sort((a, b) => a.sortKey - b.sortKey);
    const count = requests.length;
    const spacing = 16;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * spacing;
      assignedOffsets.set(`${requests[i]!.edgeId}:${requests[i]!.endpoint}`, offset);
    }
  }

  // Compute global bounds for back-edge outer corridors
  let maxRight = 0;
  let minTop = Infinity;
  for (const n of nodes) {
    if (n.x + n.width > maxRight) maxRight = n.x + n.width;
    if (n.y < minTop) minTop = n.y;
  }
  for (const g of groups) {
    if (g.x + g.width > maxRight) maxRight = g.x + g.width;
    if (g.y < minTop) minTop = g.y;
  }

  let backEdgeLane = 0;
  let channelLaneCounter = 0;
  const placedPills: Rect[] = [];
  const sceneEdges: SceneEdge[] = [];

  for (const edge of edges) {
    const src = nodeById.get(edge.from);
    const dst = nodeById.get(edge.to);
    const meta = edgeMeta.get(edge.id);
    if (!src || !dst || !meta) continue;

    const srcOff = assignedOffsets.get(`${edge.id}:source`) ?? 0;
    const dstOff = assignedOffsets.get(`${edge.id}:target`) ?? 0;
    const srcAttach = pointOnNodePerimeter(src, meta.srcFace, srcOff);
    const dstAttach = pointOnNodePerimeter(dst, meta.dstFace, dstOff);

    let waypoints: Point[];

    if (meta.isSelfLoop) {
      const loopOut = 32 + meta.pairIndex * 18;
      if (meta.srcFace === "right" && meta.dstFace === "top") {
        const cornerX = Math.max(srcAttach.stubPoint.x, src.x + src.width + loopOut);
        const cornerY = Math.min(dstAttach.stubPoint.y, src.y - loopOut);
        waypoints = [
          srcAttach.port,
          { x: cornerX, y: srcAttach.port.y },
          { x: cornerX, y: cornerY },
          { x: dstAttach.port.x, y: cornerY },
          dstAttach.port
        ];
      } else {
        const cornerY = Math.min(srcAttach.stubPoint.y, src.y - loopOut);
        const cornerX = Math.max(dstAttach.stubPoint.x, src.x + src.width + loopOut);
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: cornerY },
          { x: cornerX, y: cornerY },
          { x: cornerX, y: dstAttach.port.y },
          dstAttach.port
        ];
      }
    } else if (meta.isBackEdge) {
      backEdgeLane++;
      if (isHorizontal) {
        const corridorY = Math.min(srcAttach.stubPoint.y, dstAttach.stubPoint.y, minTop) - 24 - backEdgeLane * 24;
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: corridorY },
          { x: dstAttach.port.x, y: corridorY },
          dstAttach.port
        ];
      } else {
        const corridorX = Math.max(srcAttach.stubPoint.x, dstAttach.stubPoint.x, maxRight) + 28 + backEdgeLane * 28;
        waypoints = [
          srcAttach.port,
          { x: corridorX, y: srcAttach.port.y },
          { x: corridorX, y: dstAttach.port.y },
          dstAttach.port
        ];
      }
    } else if (meta.srcFace === "bottom" && meta.dstFace === "top") {
      // Choose midY in the safe corridor between src.bottom and dst.top avoiding any group header band
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
      const laneShift =
        meta.pairIndex > 0
          ? (meta.pairIndex % 2 === 1 ? 1 : -1) * Math.ceil(meta.pairIndex / 2) * 14
          : 0;
      const midY = Math.round((lowY + highY) / 2 + laneShift);

      if (Math.abs(srcAttach.port.x - dstAttach.port.x) < 1 && meta.pairIndex === 0) {
        waypoints = [srcAttach.port, dstAttach.port];
      } else {
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: midY },
          { x: dstAttach.port.x, y: midY },
          dstAttach.port
        ];
      }
    } else if (meta.srcFace === "top" && meta.dstFace === "bottom") {
      const laneShift =
        meta.pairIndex > 0
          ? (meta.pairIndex % 2 === 1 ? 1 : -1) * Math.ceil(meta.pairIndex / 2) * 14
          : 0;
      const midY = Math.round((srcAttach.stubPoint.y + dstAttach.stubPoint.y) / 2 + laneShift);
      if (Math.abs(srcAttach.port.x - dstAttach.port.x) < 1 && meta.pairIndex === 0) {
        waypoints = [srcAttach.port, dstAttach.port];
      } else {
        waypoints = [
          srcAttach.port,
          { x: srcAttach.port.x, y: midY },
          { x: dstAttach.port.x, y: midY },
          dstAttach.port
        ];
      }
    } else if (
      (meta.srcFace === "right" && meta.dstFace === "left") ||
      (meta.srcFace === "left" && meta.dstFace === "right")
    ) {
      channelLaneCounter++;
      const laneShift =
        meta.pairIndex > 0
          ? (meta.pairIndex % 2 === 1 ? 1 : -1) * Math.ceil(meta.pairIndex / 2) * 16
          : 0;
      const midX = Math.round((srcAttach.stubPoint.x + dstAttach.stubPoint.x) / 2 + laneShift);
      if (Math.abs(srcAttach.port.y - dstAttach.port.y) < 1 && meta.pairIndex === 0) {
        waypoints = [
          srcAttach.port,
          { x: midX, y: srcAttach.port.y + laneShift },
          { x: midX, y: dstAttach.port.y + laneShift },
          dstAttach.port
        ];
        if (laneShift === 0) waypoints = [srcAttach.port, dstAttach.port];
      } else {
        waypoints = [
          srcAttach.port,
          { x: midX, y: srcAttach.port.y },
          { x: midX, y: dstAttach.port.y },
          dstAttach.port
        ];
      }
    } else {
      // Orthogonal L/Z connection between perpendicular faces
      waypoints = [
        srcAttach.port,
        srcAttach.stubPoint,
        { x: dstAttach.stubPoint.x, y: srcAttach.stubPoint.y },
        dstAttach.stubPoint,
        dstAttach.port
      ];
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
            fill: edge.startMarker === "umlHollowTriangle" ? theme.canvas : theme.edge
          }
        : undefined;

    const endMarker: SceneMarker | undefined =
      edge.endMarker !== "none"
        ? {
            kind: edge.endMarker,
            tip: pn,
            angleRadians: Math.atan2(pn.y - pnPrev.y, pn.x - pnPrev.x),
            stroke: theme.edge,
            fill: edge.endMarker === "umlHollowTriangle" ? theme.canvas : theme.edge
          }
        : undefined;

    const labelPill =
      edge.label !== undefined && edge.label.trim().length > 0
        ? findSafePillCenter(built.points, edge.label, theme, obstacles, placedPills)
        : undefined;

    const sourceLabelPill =
      edge.sourceLabel !== undefined && edge.sourceLabel.trim().length > 0
        ? findSafePillCenter(
            [built.points[0]!, built.points[1]!],
            edge.sourceLabel,
            theme,
            obstacles,
            placedPills
          )
        : undefined;

    const targetLabelPill =
      edge.targetLabel !== undefined && edge.targetLabel.trim().length > 0
        ? findSafePillCenter(
            [built.points[built.points.length - 2]!, built.points[built.points.length - 1]!],
            edge.targetLabel,
            theme,
            obstacles,
            placedPills
          )
        : undefined;

    sceneEdges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      points: built.points,
      segments: built.segments,
      d: built.d,
      stroke: theme.edge,
      strokeWidth: edge.lineStyle === "thick" ? 2.5 : theme.edgeStrokeWidth,
      lineStyle: edge.lineStyle,
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
