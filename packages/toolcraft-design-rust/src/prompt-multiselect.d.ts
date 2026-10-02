/// <reference types="node" />
import { CANCEL } from "./cancel-symbol.js";
import { type SelectOption } from "./prompt-select.js";
export interface MultiselectOptions<Value> {
    message: string;
    options: Array<SelectOption<Value>>;
    initialValues?: Value[];
    required?: boolean;
    maxItems?: number;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function multiselectPrompt<Value>(opts: MultiselectOptions<Value>): Promise<Value[] | typeof CANCEL>;
