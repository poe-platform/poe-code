export type DiagramFamily = "flowchart" | "sequence" | "state" | "class" | "er";

export type FlowDirection = "TB" | "TD" | "BT" | "LR" | "RL";

export type MermaidThemeMode = "light" | "dark" | "default" | "neutral" | "forest" | "base";

export type MermaidErrorCode =
  | "E_SYNTAX"
  | "E_UNSUPPORTED"
  | "E_CONFIG"
  | "E_ARGUMENT"
  | "E_LIMIT"
  | "E_CANCELLED"
  | "E_IO";

export interface MermaidSourceSpan {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly length?: number;
}

export class MermaidError extends Error {
  readonly code: MermaidErrorCode;
  readonly span: MermaidSourceSpan | undefined;
  readonly limit: keyof MermaidLimits | undefined;
  readonly exitCode: 1 | 2;

  constructor(
    code: MermaidErrorCode,
    message: string,
    options?: {
      readonly span?: MermaidSourceSpan | undefined;
      readonly limit?: keyof MermaidLimits | undefined;
    }
  ) {
    super(message);
    this.name = "MermaidError";
    this.code = code;
    this.span = options?.span;
    this.limit = options?.limit;
    this.exitCode = code === "E_ARGUMENT" || code === "E_CONFIG" ? 2 : 1;
  }
}

export interface MermaidThemeTokens {
  readonly canvas: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly surfaceAccent: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly edge: string;
  readonly edgeLabelBackground: string;
  readonly edgeLabelBorder: string;
  readonly accent: string;
  readonly accentSurface: string;
  readonly accentBorder: string;
  readonly accentText: string;
  readonly groupSurface: string;
  readonly groupHeaderSurface: string;
  readonly groupBorder: string;
  readonly noteSurface: string;
  readonly noteBorder: string;
  readonly noteText: string;
  readonly activationSurface: string;
  readonly shadowColor: string;
  readonly fontFamily: string;
  readonly monospaceFontFamily: string;
  readonly fontSize: number;
  readonly secondaryFontSize: number;
  readonly lineHeight: number;
  readonly strokeWidth: number;
  readonly edgeStrokeWidth: number;
  readonly cornerRadius: number;
  readonly elbowRadius: number;
  readonly rankGap: number;
  readonly nodeGap: number;
  readonly wrappingWidth: number;
  readonly padding: number;
}

export interface MermaidLimits {
  readonly maxSourceBytes: number;
  readonly maxTokens: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxLabelBytes: number;
  readonly maxWork: number;
  readonly maxPixels: number;
  readonly maxMemoryBytes: number;
  readonly maxOutputBytes: number;
}

export interface MermaidAccounting {
  readonly sourceBytes: number;
  readonly tokens: number;
  readonly depth: number;
  readonly nodes: number;
  readonly edges: number;
  readonly work: number;
  readonly pixels: number;
  readonly memoryBytes: number;
  readonly outputBytes: number;
}

export interface MmdcSettings {
  readonly theme?: {
    readonly mode?: MermaidThemeMode | undefined;
    readonly light?: Partial<MermaidThemeTokens> | undefined;
    readonly dark?: Partial<MermaidThemeTokens> | undefined;
  } | undefined;
  readonly limits?: Partial<MermaidLimits> | undefined;
  readonly replace?: boolean | undefined;
}

export const defaultMermaidLimits: MermaidLimits = Object.freeze({
  maxSourceBytes: Infinity,
  maxTokens: Infinity,
  maxDepth: Infinity,
  maxNodes: Infinity,
  maxEdges: Infinity,
  maxLabelBytes: Infinity,
  maxWork: Infinity,
  maxPixels: Infinity,
  maxMemoryBytes: Infinity,
  maxOutputBytes: Infinity
});

export function admitMermaidLimits(
  overrides?: Partial<MermaidLimits>,
  hostCeiling: MermaidLimits = defaultMermaidLimits
): MermaidLimits {
  if (!overrides) return hostCeiling;
  const next: Record<keyof MermaidLimits, number> = { ...hostCeiling };
  for (const key of Object.keys(hostCeiling) as (keyof MermaidLimits)[]) {
    const value = overrides[key];
    if (value === undefined) continue;
    if ((value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) || value > hostCeiling[key]) {
      throw new MermaidError(
        "E_LIMIT",
        `Resource limit '${key}' must be a positive safe integer within host ceiling (${hostCeiling[key]})`,
        { limit: key }
      );
    }
    next[key] = value;
  }
  return Object.freeze(next);
}

export class MermaidBudget {
  readonly limits: MermaidLimits;
  readonly signal: AbortSignal | undefined;
  private sourceBytesUsed = 0;
  private tokensUsed = 0;
  private depthUsed = 0;
  private nodesUsed = 0;
  private edgesUsed = 0;
  private workUsed = 0;
  private pixelsUsed = 0;
  private memoryBytesUsed = 0;
  private outputBytesUsed = 0;

  constructor(limits: MermaidLimits = defaultMermaidLimits, signal?: AbortSignal) {
    this.limits = limits;
    this.signal = signal;
  }

  check(): void {
    if (this.signal?.aborted) {
      const reason = this.signal.reason;
      if (reason instanceof MermaidError) throw reason;
      throw new MermaidError("E_CANCELLED", "Mermaid rendering was cancelled");
    }
  }

  chargeSourceBytes(amount: number): void {
    this.check();
    this.sourceBytesUsed += amount;
    if (this.sourceBytesUsed > this.limits.maxSourceBytes) {
      throw new MermaidError("E_LIMIT", "Source byte limit exceeded", { limit: "maxSourceBytes" });
    }
  }

  chargeTokens(amount = 1): void {
    this.check();
    this.tokensUsed += amount;
    if (this.tokensUsed > this.limits.maxTokens) {
      throw new MermaidError("E_LIMIT", "Token limit exceeded", { limit: "maxTokens" });
    }
  }

  enterDepth(depth: number): void {
    this.check();
    if (depth > this.depthUsed) this.depthUsed = depth;
    if (depth > this.limits.maxDepth) {
      throw new MermaidError("E_LIMIT", "Nesting depth limit exceeded", { limit: "maxDepth" });
    }
  }

  chargeNodes(amount = 1): void {
    this.check();
    this.nodesUsed += amount;
    if (this.nodesUsed > this.limits.maxNodes) {
      throw new MermaidError("E_LIMIT", "Node limit exceeded", { limit: "maxNodes" });
    }
  }

  chargeEdges(amount = 1): void {
    this.check();
    this.edgesUsed += amount;
    if (this.edgesUsed > this.limits.maxEdges) {
      throw new MermaidError("E_LIMIT", "Edge limit exceeded", { limit: "maxEdges" });
    }
  }

  checkLabelBytes(byteLength: number, span?: MermaidSourceSpan): void {
    this.check();
    if (byteLength > this.limits.maxLabelBytes) {
      throw new MermaidError("E_LIMIT", "Label byte limit exceeded", {
        limit: "maxLabelBytes",
        span
      });
    }
  }

  chargeWork(amount = 1): void {
    this.check();
    this.workUsed += amount;
    if (this.workUsed > this.limits.maxWork) {
      throw new MermaidError("E_LIMIT", "Render work budget exceeded", { limit: "maxWork" });
    }
  }

  chargePixels(pixels: number): void {
    this.check();
    this.pixelsUsed = Math.max(this.pixelsUsed, pixels);
    if (pixels > this.limits.maxPixels) {
      throw new MermaidError("E_LIMIT", "Raster pixel limit exceeded", { limit: "maxPixels" });
    }
  }

  chargeMemoryBytes(bytes: number): void {
    this.check();
    this.memoryBytesUsed += bytes;
    if (this.memoryBytesUsed > this.limits.maxMemoryBytes) {
      throw new MermaidError("E_LIMIT", "Memory byte budget exceeded", { limit: "maxMemoryBytes" });
    }
  }

  chargeOutputBytes(bytes: number): void {
    this.check();
    this.outputBytesUsed += bytes;
    if (this.outputBytesUsed > this.limits.maxOutputBytes) {
      throw new MermaidError("E_LIMIT", "Output byte limit exceeded", { limit: "maxOutputBytes" });
    }
  }

  snapshot(): MermaidAccounting {
    return Object.freeze({
      sourceBytes: this.sourceBytesUsed,
      tokens: this.tokensUsed,
      depth: this.depthUsed,
      nodes: this.nodesUsed,
      edges: this.edgesUsed,
      work: this.workUsed,
      pixels: this.pixelsUsed,
      memoryBytes: this.memoryBytesUsed,
      outputBytes: this.outputBytesUsed
    });
  }
}

export type NodeShape =
  | "rect"
  | "rounded"
  | "stadium"
  | "diamond"
  | "circle"
  | "stateStart"
  | "stateEnd"
  | "classCard"
  | "erEntity"
  | "participant"
  | "cylinder"
  | "subroutine"
  | "hexagon";

export type EdgeLineStyle = "solid" | "dotted" | "thick";

export type EdgeMarkerKind =
  | "none"
  | "arrow"
  | "openArrow"
  | "cross"
  | "umlHollowTriangle"
  | "umlComposition"
  | "umlAggregation"
  | "erExactlyOne"
  | "erZeroOrOne"
  | "erOneOrMore"
  | "erZeroOrMore";

export interface CompartmentMember {
  readonly visibility?: "+" | "-" | "#" | "~" | undefined;
  readonly name: string;
  readonly typeOrReturn?: string | undefined;
  readonly badge?: "PK" | "FK" | "UK" | undefined;
  readonly isMethod?: boolean | undefined;
}

export interface DocumentNode {
  readonly id: string;
  readonly label: string;
  readonly shape: NodeShape;
  readonly groupId?: string | undefined;
  readonly stereotype?: string | undefined;
  readonly attributes?: readonly CompartmentMember[] | undefined;
  readonly methods?: readonly CompartmentMember[] | undefined;
  readonly accent?: boolean | undefined;
  readonly span?: MermaidSourceSpan | undefined;
}

export interface DocumentGroup {
  readonly id: string;
  readonly label: string;
  readonly parentId?: string | undefined;
  readonly kind: "subgraph" | "compositeState" | "namespace" | "sequenceBlock";
  readonly blockKeyword?: "loop" | "alt" | "opt" | undefined;
  readonly branches?: readonly { readonly label: string; readonly messageIndices: readonly number[] }[] | undefined;
  readonly span?: MermaidSourceSpan | undefined;
}

export interface DocumentEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string | undefined;
  readonly sourceLabel?: string | undefined;
  readonly targetLabel?: string | undefined;
  readonly lineStyle: EdgeLineStyle;
  readonly startMarker: EdgeMarkerKind;
  readonly endMarker: EdgeMarkerKind;
  readonly activateTarget?: boolean | undefined;
  readonly deactivateSource?: boolean | undefined;
  readonly sequenceIndex?: number | undefined;
  readonly span?: MermaidSourceSpan | undefined;
}

export interface DocumentNote {
  readonly id: string;
  readonly text: string;
  readonly targetIds: readonly string[];
  readonly position: "left" | "right" | "over";
  readonly sequenceIndex?: number | undefined;
  readonly span?: MermaidSourceSpan | undefined;
}

export interface SequenceActivationEvent {
  readonly participantId: string;
  readonly action: "activate" | "deactivate";
  readonly sequenceIndex: number;
  readonly span?: MermaidSourceSpan | undefined;
}

export interface MermaidDocument {
  readonly family: DiagramFamily;
  readonly direction: FlowDirection;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly nodes: readonly DocumentNode[];
  readonly groups: readonly DocumentGroup[];
  readonly edges: readonly DocumentEdge[];
  readonly notes: readonly DocumentNote[];
  readonly activations?: readonly SequenceActivationEvent[] | undefined;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SceneTextLine {
  readonly text: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly fontWeight: 400 | 500 | 600 | 700;
  readonly fontFamily: "ui" | "mono";
  readonly color: string;
  readonly align: "left" | "center" | "right";
}

export interface SceneBadge {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly fill: string;
  readonly stroke: string;
  readonly text: SceneTextLine;
}

export interface SceneDivider {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stroke: string;
}

export interface SceneNode {
  readonly id: string;
  readonly shape: NodeShape;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly fill: string;
  readonly headerFill?: string | undefined;
  readonly headerHeight?: number | undefined;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly shadow: boolean;
  readonly groupId?: string | undefined;
  readonly lines: readonly SceneTextLine[];
  readonly dividers: readonly SceneDivider[];
  readonly badges: readonly SceneBadge[];
}

export interface SceneGroup {
  readonly id: string;
  readonly parentId?: string | undefined;
  readonly kind: DocumentGroup["kind"];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly fill: string;
  readonly headerFill: string;
  readonly headerHeight: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dashed?: boolean | undefined;
  readonly label: SceneTextLine;
  readonly sectionDividers?: readonly {
    readonly y: number;
    readonly label?: SceneTextLine | undefined;
  }[] | undefined;
}

export type PathSegment =
  | { readonly kind: "M"; readonly x: number; readonly y: number }
  | { readonly kind: "L"; readonly x: number; readonly y: number }
  | { readonly kind: "Q"; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number };

export interface SceneMarker {
  readonly kind: EdgeMarkerKind;
  readonly tip: Point;
  readonly angleRadians: number;
  readonly stroke: string;
  readonly fill: string;
}

export interface SceneLabelPill {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly fill: string;
  readonly stroke: string;
  readonly lines: readonly SceneTextLine[];
}

export interface SceneEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly points: readonly Point[];
  readonly segments: readonly PathSegment[];
  readonly d: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly lineStyle: EdgeLineStyle;
  readonly startMarker: SceneMarker | undefined;
  readonly endMarker: SceneMarker | undefined;
  readonly labelPill?: SceneLabelPill | undefined;
  readonly sourceLabelPill?: SceneLabelPill | undefined;
  readonly targetLabelPill?: SceneLabelPill | undefined;
  readonly sourcePort: Point;
  readonly targetPort: Point;
  readonly sourceNormal: Point;
  readonly targetNormal: Point;
}

export interface SceneNote {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly fill: string;
  readonly stroke: string;
  readonly shadow: boolean;
  readonly lines: readonly SceneTextLine[];
}

export interface SceneLifeline {
  readonly participantId: string;
  readonly x: number;
  readonly y1: number;
  readonly y2: number;
  readonly stroke: string;
}

export interface SceneActivation {
  readonly participantId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly stroke: string;
}

export interface MermaidScene {
  readonly family: DiagramFamily;
  readonly direction: FlowDirection;
  readonly width: number;
  readonly height: number;
  readonly viewBox: Rect;
  readonly naturalBounds: { readonly width: number; readonly height: number };
  readonly padding: number;
  readonly theme: MermaidThemeTokens;
  readonly backgroundColor: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly groups: readonly SceneGroup[];
  readonly lifelines: readonly SceneLifeline[];
  readonly activations: readonly SceneActivation[];
  readonly edges: readonly SceneEdge[];
  readonly nodes: readonly SceneNode[];
  readonly notes: readonly SceneNote[];
}

export interface MermaidParseOptions {
  readonly limits?: Partial<MermaidLimits> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly budget?: MermaidBudget | undefined;
}

export interface MermaidLayoutOptions extends MermaidParseOptions {
  readonly theme?: MermaidThemeMode | Partial<MermaidThemeTokens> | undefined;
  readonly settings?: MmdcSettings | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly backgroundColor?: string | undefined;
  readonly rankGap?: number | undefined;
  readonly nodeGap?: number | undefined;
  readonly padding?: number | undefined;
  readonly wrappingWidth?: number | undefined;
}

export interface MermaidRenderOptions extends MermaidLayoutOptions {
  readonly mermaidConfig?: Readonly<Record<string, unknown>> | undefined;
  readonly svgId?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

export interface MermaidPngRenderOptions extends MermaidRenderOptions {
  readonly scale?: number | undefined;
}

export interface MermaidSvgResult {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly naturalBounds: { readonly width: number; readonly height: number };
  readonly family: DiagramFamily;
  readonly accounting: MermaidAccounting;
}

export interface MermaidPngResult {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly naturalBounds: { readonly width: number; readonly height: number };
  readonly family: DiagramFamily;
  readonly accounting: MermaidAccounting;
}
