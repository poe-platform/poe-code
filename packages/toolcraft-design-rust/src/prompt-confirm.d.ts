/// <reference types="node" />
import { CANCEL } from "./cancel-symbol.js";
export interface ConfirmOptions {
    message: string;
    initialValue?: boolean;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function confirmPrompt(opts: ConfirmOptions): Promise<boolean | typeof CANCEL>;
