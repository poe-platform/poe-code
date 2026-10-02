export interface GraphemeCell { value: string; start: number; end: number; width: number; }
export declare function cellWidth(value: string, startColumn?: number): number;
export declare function fitToWidth(text: string, width: number, startColumn?: number): string;
export declare function centerCells(text: string, width: number, startColumn?: number): string;
export declare function padEndCells(text: string, width: number, fill?: string, startColumn?: number): string;
export declare function splitGraphemeCells(value: string, startColumn?: number): GraphemeCell[];
export declare function stripAnsi(value: string): string;
