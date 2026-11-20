export interface Resource {readonly id: string; readonly bytes: Uint8Array}
export interface ConversionRequest {
  readonly mode: "html" | "pandoc";
  readonly format: "docx" | "pdf";
  readonly title?: string;
  readonly html?: string;
  readonly document?: {readonly blocks: readonly unknown[]; readonly metadata: Readonly<Record<string, unknown>>; readonly language?: string; readonly direction?: string};
  readonly resources?: readonly Resource[];
  readonly options?: Readonly<Record<string, unknown>>;
  readonly limits?: Readonly<Record<string, number>>;
}
export interface ConversionResult {readonly bytes: Uint8Array; readonly diagnostics: readonly {code: string; message: string}[]; readonly usage: Readonly<Record<string, number>>}
export interface ConversionControl {readonly signal?: AbortSignal | undefined; readonly cooperate?: (() => Promise<void>) | undefined}
export type VectorColor = readonly [number, number, number, number];
export interface VectorPath {readonly rule: "nonzero" | "evenodd"; readonly segments: readonly (readonly ["M" | "L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"])[]}
export interface VectorStroke {readonly color: VectorColor; readonly width: number; readonly dash: readonly number[]; readonly dashOffset: number; readonly lineCap: "butt" | "round" | "square"; readonly lineJoin: "miter" | "round" | "bevel"; readonly miterLimit: number}
export interface VectorText {readonly text: string; readonly baseline: readonly [number, number]; readonly width: number; readonly ascent: number; readonly fontSize: number; readonly fontFamily: string; readonly bold: boolean; readonly italic: boolean; readonly underline: boolean; readonly strike: boolean; readonly color: VectorColor}
export interface VectorImage {readonly data: string; readonly width: number; readonly height: number; readonly alt: string; readonly title: string; readonly link?: string | null}
export type VectorNode = {readonly id?: string | null; readonly bounds: readonly [number, number, number, number]; readonly transform: readonly [number, number, number, number, number, number]; readonly opacity: number; readonly clip?: VectorPath | null} & (
  {readonly kind: "group"; readonly children: readonly VectorNode[]} |
  {readonly kind: "path"; readonly path: VectorPath; readonly fill?: VectorColor | null; readonly stroke?: VectorStroke | null} |
  {readonly kind: "text"; readonly text: VectorText} |
  {readonly kind: "raster"; readonly image: VectorImage});
export interface VectorScene {readonly width: number; readonly height: number; readonly nodes: readonly VectorNode[]}
export type DiagramThemeMode = "light" | "dark" | "default" | "neutral" | "forest" | "base";
export type DiagramThemeTokens = Partial<Record<
  "canvas" | "surface" | "surfaceElevated" | "surfaceAccent" | "text" | "mutedText" |
  "border" | "borderStrong" | "edge" | "edgeLabelBackground" | "edgeLabelBorder" |
  "accent" | "accentSurface" | "accentBorder" | "accentText" | "groupSurface" |
  "groupHeaderSurface" | "groupBorder" | "noteSurface" | "noteBorder" | "noteText" |
  "activationSurface" | "shadowColor" | "fontFamily" | "monospaceFontFamily", string> & Record<
  "fontSize" | "secondaryFontSize" | "lineHeight" | "strokeWidth" | "edgeStrokeWidth" |
  "cornerRadius" | "elbowRadius" | "rankGap" | "nodeGap" | "wrappingWidth" | "padding", number>>;
export type DiagramTheme = DiagramThemeMode | {readonly mode?: DiagramThemeMode; readonly light?: DiagramThemeTokens; readonly dark?: DiagramThemeTokens};
export interface DrawingRequest {readonly mode: "drawing"; readonly format: "mermaid" | "graphviz"; readonly source: string; readonly theme?: DiagramTheme}
export interface DrawingResult {readonly svg: string; readonly scene: VectorScene}
export interface Converter {
  (request: ConversionRequest, control?: ConversionControl): Promise<ConversionResult>;
  (request: DrawingRequest, control?: ConversionControl): Promise<DrawingResult>;
}
export function createConverter(loadWasm: () => Promise<Uint8Array | ArrayBuffer | WebAssembly.Module>): Converter;
