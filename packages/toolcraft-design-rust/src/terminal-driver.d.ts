/// <reference types="node" />
import type {Buffer} from "node:buffer";
import { type TerminalInputEvent } from "./terminal-input.js";
export interface Size {
    cols: number;
    rows: number;
}
export interface TerminalDriver {
    start(): void;
    stop(): void;
    onEvent(fn: (event: TerminalInputEvent) => void): () => void;
    onResize(fn: (size: Size) => void): () => void;
    getSize(): Size;
    writeFrame(ansi: string): void;
}
interface InputStream {
    setRawMode?: (enabled: boolean) => void;
    resume(): void;
    pause(): void;
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
    off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}
interface OutputStream {
    columns?: number;
    rows?: number;
    write(value: string): boolean;
    on(event: "resize", listener: () => void): unknown;
    off(event: "resize", listener: () => void): unknown;
}
export declare function createTerminalDriver(options?: {
    input?: InputStream;
    output?: OutputStream;
    escTimeoutMs?: number;
    mouse?: boolean;
}): TerminalDriver;
export type { TerminalInputEvent } from "./terminal-input.js";
