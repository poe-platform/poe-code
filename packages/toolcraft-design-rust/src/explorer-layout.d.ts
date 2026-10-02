export type ExplorerLayoutMode = "wide" | "medium" | "narrow-vertical" | "narrow-list-only" | "too-narrow";
export interface Rect { x: number; y: number; width: number; height: number; }
export interface ExplorerLayoutOptions { cols: number; rows: number; detailHidden?: boolean; focused?: "list" | "detail"; }
export interface ExplorerLayout { mode: ExplorerLayoutMode; header: Rect; list: Rect; detail: Rect; footer: Rect; }
export declare function computeExplorerLayout(opts: ExplorerLayoutOptions): ExplorerLayout;
export declare function paneBodyRect(rect: Rect): Rect;
