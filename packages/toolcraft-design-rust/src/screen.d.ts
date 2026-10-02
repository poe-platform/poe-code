import type { Rect } from "./dashboard-types.js";
type CellStyle = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; inverse?: boolean; underline?: boolean };
import { type PackedStyle } from "./screen-style.js";
export interface Cell {
    ch: string;
    width: 1 | 2;
    style: PackedStyle;
    fg: number;
    bg: number;
}
export interface ScreenSize {
    cols: number;
    rows: number;
}
export interface ScreenSurface {
    readonly width: number;
    readonly height: number;
    put(x: number, y: number, text: string, style?: CellStyle | PackedStyle): void;
    clearRect(rect: Rect, style?: CellStyle | PackedStyle): void;
}
export declare class Screen {
    private cols;
    private rows;
    private front;
    private back;
    private outputStyle;
    private readonly colors;
    constructor(size?: ScreenSize, options?: {
        colors?: boolean;
    });
    get width(): number;
    get height(): number;
    resize(size: ScreenSize): void;
    cell(x: number, y: number, ch: string, style?: PackedStyle): void;
    text(x: number, y: number, text: string, style?: PackedStyle): void;
    put(x: number, y: number, text: string, style?: CellStyle | PackedStyle): void;
    clearRect(rect: Rect, style?: CellStyle | PackedStyle): void;
    flush(): string;
    private index;
    private inBounds;
}
