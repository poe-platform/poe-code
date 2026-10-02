import type { Cell, CellStyle, Rect } from "./dashboard-types.js";
export declare class ScreenBuffer {
    private _width;
    private _height;
    private _cells;
    constructor(width: number, height: number);
    get width(): number;
    get height(): number;
    put(x: number, y: number, text: string, style?: CellStyle): void;
    get(x: number, y: number): Cell;
    clear(style?: CellStyle): void;
    clearRect(rect: Rect, style?: CellStyle): void;
    resize(width: number, height: number): void;
    putInRect(rect: Rect, row: number, text: string, style?: CellStyle): void;
    private index;
    private isInBounds;
    private isInBoundsX;
    private isInBoundsY;
}
export declare function diff(prev: ScreenBuffer, next: ScreenBuffer): Array<{
    x: number;
    y: number;
    cell: Cell;
}>;
export declare function cellToAnsi(cell: Cell): string;
