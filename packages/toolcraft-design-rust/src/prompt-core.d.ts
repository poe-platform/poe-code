/// <reference types="node" />
import { EventEmitter } from "node:events";
import { CANCEL } from "./cancel-symbol.js";
export type PromptStateName = "initial" | "active" | "submit" | "cancel" | "error";
/**
 * Builds the non-TTY rejection message, naming the documented `--yes` flag for the
 * command being run and keeping `POE_NO_PROMPT=1` as the secondary CI alternative.
 */
export declare function nonTtyPromptMessage(argv?: string[]): string;
export interface PromptState<Value> {
    state: PromptStateName;
    value: Value | undefined;
    error: string;
    cursor: number;
    userInput: string;
}
export interface PromptOptions<Value> {
    render: (state: Prompt<Value>) => string;
    initialValue?: Value;
    initialUserInput?: string;
    validate?: (value: Value | undefined) => string | Error | undefined;
    signal?: AbortSignal;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}
type InputStream = NodeJS.ReadableStream & {
    isTTY?: boolean;
    destroyed?: boolean;
    readableEnded?: boolean;
    setRawMode?: (enabled: boolean) => void;
    unpipe?: () => void;
};
export declare class Prompt<Value> extends EventEmitter {
    state: PromptStateName;
    value: Value | undefined;
    error: string;
    userInput: string;
    protected _cursor: number;
    protected input: InputStream;
    protected output: NodeJS.WritableStream;
    private readonly renderFrame;
    private readonly validate?;
    private readonly signal?;
    private readonly trackValue;
    private previousFrame;
    private readlineInterface?;
    private closed;
    constructor(opts: PromptOptions<Value>, trackValue?: boolean);
    get cursor(): number;
    prompt(): Promise<Value | typeof CANCEL>;
    protected promptNonTty(): Promise<Value | typeof CANCEL>;
    protected readNonTtyLine(): Promise<string | typeof CANCEL>;
    protected setValue(value: Value | undefined): void;
    protected setError(message: string): void;
    protected setUserInput(value: string): void;
    protected clearUserInput(): void;
    private readonly onCancel;
    private readonly onKeypress;
    private updateTrackedInput;
    protected readonly render: () => void;
    protected close(): void;
}
export {};
