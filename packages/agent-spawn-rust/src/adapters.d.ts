import type { AcpEvent, SessionUpdate } from "./acp-types.js";
export type AdapterType = "codex" | "claude" | "cursor" | "native" | "opencode" | "pi";
export type AdapterOutput = AcpEvent | SessionUpdate;
export type Adapter = (lines: AsyncIterable<string>) => AsyncGenerator<AdapterOutput>;
export declare function getAdapter(type: AdapterType): Adapter;
export declare const TOOL_KIND_MAP: Record<string, string>;
export declare function adaptClaude(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent>;
export declare function adaptCodex(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent>;
export declare function adaptCursor(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent>;
export declare function adaptOpenCode(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent>;
export declare function adaptPi(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent>;
declare function adaptNative(
  lines: AsyncIterable<string>
): AsyncGenerator<{ event: string } & Record<string, unknown>>;
export { adaptNative };
