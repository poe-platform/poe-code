/// <reference types="node" />
import type { CANCEL } from "./cancel-symbol.js";
import { type SelectOption } from "./prompt-select.js";
import { cancel, isCancel } from "./prompt-cancel-primitive.js";
import { intro } from "./prompt-intro.js";
import { log } from "./prompt-log-primitive.js";
import { note } from "./note.js";
import { outro } from "./prompt-outro.js";
import { spinner } from "./spinner.js";
export { isCancel, cancel, log };
export { intro, outro, note, spinner };
export declare function introPlain(title: string): void;
export interface SelectOptions<Value> {
    message: string;
    options: Array<SelectOption<Value>>;
    initialValue?: Value;
    maxItems?: number;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function select<Value>(opts: SelectOptions<Value>): Promise<Value | typeof CANCEL>;
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
/**
 * Prompts the user to select one or more values from a list.
 *
 * Returns the selected values as an array, or a cancellation symbol if the
 * user cancels. Use `isCancel` to check for cancellation.
 *
 * @example
 * const result = await multiselect({
 *   message: "Pick workflows to run",
 *   options: [{ label: "Fix Vulnerabilities", value: "fix-vulnerabilities" }],
 *   required: true
 * });
 * if (!isCancel(result)) {
 *   // result is Value[]
 * }
 */
export declare function multiselect<Value>(opts: MultiselectOptions<Value>): Promise<Value[] | typeof CANCEL>;
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
export declare function text(opts: TextOptions): Promise<string | typeof CANCEL>;
export interface ConfirmOptions {
    message: string;
    initialValue?: boolean;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function confirm(opts: ConfirmOptions): Promise<boolean | typeof CANCEL>;
export declare class PromptCancelledError extends Error {
    constructor(message?: string);
}
export declare function confirmOrCancel(opts: ConfirmOptions): Promise<boolean>;
export interface PasswordOptions {
    message: string;
    validate?: (value: string) => string | Error | undefined;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
export declare function password(opts: PasswordOptions): Promise<string | typeof CANCEL>;
export type SpinnerOptions = {
    start: (message?: string) => void;
    stop: (message?: string, code?: number) => void;
    message: (message?: string) => void;
};
export interface WithSpinnerOptions<T> {
    message: string | (() => string);
    fn: () => Promise<T>;
    stopMessage?: (result: T) => string;
    subtext?: (result: T) => string | undefined;
}
export declare function withSpinner<T>(options: WithSpinnerOptions<T>): Promise<T>;
