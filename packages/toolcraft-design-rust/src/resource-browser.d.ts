import type { ThemePalette } from "./theme.js";
export interface ResourceBrowserItem { label: string; meta?: string[]; preview?: string; badge?: string; }
export interface ResourceBrowserGroup {
  title: string;
  description?: string;
  emptyHint?: string;
  items: ResourceBrowserItem[];
}
export interface RenderResourceBrowserOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  groups: ResourceBrowserGroup[];
  footer?: string;
}
export declare function renderResourceBrowser(options: RenderResourceBrowserOptions): string;
