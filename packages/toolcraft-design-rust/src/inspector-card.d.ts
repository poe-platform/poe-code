import type { ThemePalette } from "./theme.js";
export interface InspectorField { label: string; value: string; }
export interface InspectorSection { title?: string; fields: InspectorField[]; }
export interface RenderInspectorCardOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  badges?: string[];
  preview?: string;
  previewTitle?: string;
  sections?: InspectorSection[];
  width?: number;
  maxPreviewLines?: number;
}
export declare function renderInspectorCard(options: RenderInspectorCardOptions): string;
