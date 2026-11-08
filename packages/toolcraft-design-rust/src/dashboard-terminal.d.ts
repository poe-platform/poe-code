/// <reference types="node" />
import type { Cell } from "./dashboard-types.js";
export type KeypressEvent = {
    name?: string;
    ch?: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
};
export type TerminalDriver = {
    enterRawMode(): void;
    exitRawMode(): void;
    enterAltScreen(): void;
    exitAltScreen(): void;
    disableLineWrap(): void;
    enableLineWrap(): void;
    hideCursor(): void;
    showCursor(): void;
    moveTo(x: number, y: number): void;
    write(text: string): void;
    flush(changes: Array<{
        x: number;
        y: number;
        cell: Cell;
    }>): void;
    getSize(): {
        cols: number;
        rows: number;
    };
    onResize(handler: () => void): () => void;
    onKeypress(handler: (key: KeypressEvent) => void): () => void;
    destroy(): void;
};
export declare function createTerminalDriver(opts?: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
}): TerminalDriver;
export declare function parseKeypress(data: Buffer): KeypressEvent | undefined;
