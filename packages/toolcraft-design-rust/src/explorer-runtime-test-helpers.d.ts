import type { TerminalDriver, TerminalInputEvent } from "./terminal-driver.js";
export declare class FakeTerminalDriver implements TerminalDriver {
    private cols;
    private rows;
    readonly writes: string[];
    started: boolean;
    startCount: number;
    stopCount: number;
    private readonly eventHandlers;
    private readonly resizeHandlers;
    constructor(cols?: number, rows?: number);
    get output(): string;
    get destroyed(): boolean;
    get altScreen(): boolean;
    get enterAltScreenCount(): number;
    start(): void;
    stop(): void;
    onEvent(handler: (event: TerminalInputEvent) => void): () => void;
    onResize(handler: (size: {
        cols: number;
        rows: number;
    }) => void): () => void;
    getSize(): {
        cols: number;
        rows: number;
    };
    writeFrame(ansi: string): void;
    resize(cols: number, rows: number): void;
    press(key: {
        name?: string;
        ch?: string;
        ctrl: boolean;
        meta: boolean;
        shift: boolean;
    }): void;
}
