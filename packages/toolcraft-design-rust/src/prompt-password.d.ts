/// <reference types="node" />
import { CANCEL } from "./cancel-symbol.js";
export interface PasswordOptions {
    message: string;
    mask?: string;
    validate?: (value: string) => string | Error | undefined;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function passwordPrompt(opts: PasswordOptions): Promise<string | typeof CANCEL>;
