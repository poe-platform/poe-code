/// <reference types="node" />
import { CANCEL } from "./cancel-symbol.js";
export interface TextOptions {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    initialValue?: string;
    validate?: (value: string) => string | Error | undefined;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function textPrompt(opts: TextOptions): Promise<string | typeof CANCEL>;
