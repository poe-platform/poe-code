import type {Tone} from './explorer-state.js';
type CellStyle = {fg?: string; bg?: string; bold?: boolean; dim?: boolean; underline?: boolean;};
export interface ExplorerTheme {
  accent: (text: string) => string;
  muted: (text: string) => string;
  border: (text: string) => string;
  borderFocused: (text: string) => string;
  badge: (text: string, tone: Tone) => string;
  matchHighlight: (text: string) => string;
}
export interface ExplorerStyles {
  accent: CellStyle;
  muted: CellStyle;
  border: CellStyle;
  borderFocused: CellStyle;
  matchHighlight: CellStyle;
  tones: Record<Tone, CellStyle>;
}
export declare function getExplorerTheme(): ExplorerTheme;
export declare function getExplorerStyles(): ExplorerStyles;
export {};
