import type { ThemePalette } from "./theme.js";
export interface DetailCardRow { label: string; value: string; }
export interface DetailCardSection { title?: string; rows: DetailCardRow[]; }
export interface RenderDetailCardOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  badges?: string[];
  prose?: Array<{title?: string; value: string}>;
  sections?: DetailCardSection[];
  width?: number;
}
export declare function renderDetailCard(options: RenderDetailCardOptions): string;
