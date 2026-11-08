import type {Rect} from "./dashboard-types.js";

export interface LayoutOptions {
  totalWidth: number;
  totalHeight: number;
  rightPaneWidth?: number;
  footerHeight?: number;
  borderWidth?: number;
}
export interface DashboardLayout {
  summary?: Rect;
  outerBorder: Rect;
  leftPane: Rect;
  rightPane: Rect;
  divider: { x: number; top: number; bottom: number };
  footer: Rect;
  footerDivider: { y: number; left: number; right: number };
}
export declare function computeDashboardLayout(options: LayoutOptions): DashboardLayout;
