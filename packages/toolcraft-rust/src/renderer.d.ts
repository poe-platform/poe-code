import type { Command, RenderPrimitives } from "./index.js";
export type OutputMode = "rich" | "md" | "json" | (string & {});
type WriteStream = "stdout" | "stderr";
type WriteFn = (chunk: string, stream?: WriteStream) => void;
export interface RenderResultStatus { mcpError: boolean; }
export declare function renderObjectTable(result: Record<string, unknown>, primitives: RenderPrimitives): string;
export declare function renderArrayTable(result: Array<Record<string, unknown>>, primitives: RenderPrimitives): string;
export declare function renderResult(command: Command<any, any, any, any>, result: unknown, output: OutputMode, primitives: RenderPrimitives, write?: WriteFn): RenderResultStatus;
export {};
