import type {CellStyle} from "./dashboard-types.js";
export interface StyledSegment {text: string; style: CellStyle;}
export interface StyledLine {segments: StyledSegment[];}
export declare function plainTerminalText(text: string): string;
export declare function hasAnsi(text: string): boolean;
export declare function parseAnsi(text: string, baseStyle?: CellStyle): StyledLine[];
