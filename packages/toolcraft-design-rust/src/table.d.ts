import type { ThemePalette } from "./theme.js";

export interface TableColumn {
  name: string;
  title: string;
  alignment: "left" | "right";
  maxLen: number;
}

export interface RenderTableOptions {
  theme: ThemePalette;
  columns: TableColumn[];
  rows: Record<string, string>[];
  variant?: "table" | "detail";
  maxWidth?: number;
}

export declare function renderTable(options: RenderTableOptions): string;
export declare function loggerTableWidth(): number | undefined;
