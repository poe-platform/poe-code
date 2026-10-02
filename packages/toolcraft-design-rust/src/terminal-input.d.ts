/// <reference types="node" />
import type {Buffer} from "node:buffer";
export type TerminalInputEvent = {
    type: "key";
    name: string;
    ch?: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
} | {
    type: "paste";
    text: string;
} | {
    type: "wheel";
    direction: "up" | "down";
    x: number;
    y: number;
};
export interface InputParser {
    feed(chunk: Buffer): TerminalInputEvent[];
    flush(): TerminalInputEvent[];
    destroy(): void;
}
export declare function createInputParser(options?: {
    escTimeoutMs?: number;
    onEvent?: (event: TerminalInputEvent) => void;
}): InputParser;
