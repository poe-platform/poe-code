import type { ThemePalette } from "./theme.js";
export type CatalogTone = "accent" | "muted" | "success" | "warning" | "error" | "info";
export interface CatalogMetric { label: string; value: string | number; tone?: CatalogTone; }
export interface CatalogItem { label: string; value: string; detail?: string; tone?: CatalogTone; }
export interface CatalogGroup { title: string; description?: string; items: CatalogItem[]; }
export interface RenderCatalogOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  metrics?: CatalogMetric[];
  groups: CatalogGroup[];
}
export declare function renderCatalog(options: RenderCatalogOptions): string;
