import type { ChatMessage, ToolResult, ToolResultPart } from "./types.js";
export declare function isToolResultPart(value: unknown): value is ToolResultPart;
export declare function getStructuredToolResultParts(value: unknown): ToolResultPart[] | undefined;
export declare function normalizeToolResult(value: unknown): ToolResult;
export declare function toToolMessageContent(value: unknown): ChatMessage["content"];
export declare function toolResultPartToText(part: ToolResultPart): string;
export declare function estimateMessageContentSize(content: ChatMessage["content"]): number;
