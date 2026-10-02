import { PassThrough, Writable } from "node:stream";
export interface PromptHarness {
    input: PassThrough & {
        isTTY?: boolean;
        setRawMode?: (enabled: boolean) => void;
    };
    output: Writable & {
        columns?: number;
        rows?: number;
        isTTY?: boolean;
        frames: string[];
    };
    rawModes: boolean[];
    getOutput: () => string;
}
export declare function createPromptHarness(options?: {
    tty?: boolean;
    columns?: number;
    rows?: number;
}): PromptHarness;
export declare function tick(): Promise<void>;
