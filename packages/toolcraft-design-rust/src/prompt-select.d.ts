/// <reference types="node" />
import { CANCEL } from "./cancel-symbol.js";
export interface SelectOption<Value> {
    value: Value;
    label: string;
    hint?: string;
    disabled?: boolean;
}
export interface SelectOptions<Value> {
    message: string;
    options: Array<SelectOption<Value>>;
    initialValue?: Value;
    maxItems?: number;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function findNonDisabled<Value>(start: number, direction: 1 | -1, options: Array<SelectOption<Value>>): number;
export declare function selectPrompt<Value>(opts: SelectOptions<Value>): Promise<Value | typeof CANCEL>;
