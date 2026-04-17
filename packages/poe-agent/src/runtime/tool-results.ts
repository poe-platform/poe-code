import type { ChatMessage, ToolResult, ToolResultPart } from "./types.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isToolResultPart(value: unknown): value is ToolResultPart {
  if (!isObjectRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "image") {
    return typeof value.mimeType === "string" && typeof value.data === "string";
  }

  if (value.type === "error") {
    return (
      typeof value.code === "string" &&
      typeof value.message === "string" &&
      typeof value.retriable === "boolean"
    );
  }

  return false;
}

export function getStructuredToolResultParts(value: unknown): ToolResultPart[] | undefined {
  if (isToolResultPart(value)) {
    return [value];
  }

  if (!Array.isArray(value) || value.length === 0 || !value.every(isToolResultPart)) {
    return undefined;
  }

  return value;
}

export function normalizeToolResult(value: unknown): ToolResult {
  if (typeof value === "string") {
    return value;
  }

  if (isToolResultPart(value)) {
    return value;
  }

  if (Array.isArray(value) && value.every(isToolResultPart)) {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function toToolMessageContent(value: unknown): ChatMessage["content"] {
  const normalized = normalizeToolResult(value);

  if (typeof normalized === "string") {
    return normalized;
  }

  if (!Array.isArray(normalized) && normalized.type === "text") {
    return normalized.text;
  }

  return Array.isArray(normalized) ? normalized : [normalized];
}

export function toolResultPartToText(part: ToolResultPart): string {
  if (part.type === "text") {
    return part.text;
  }

  if (part.type === "image") {
    return `[image: ${part.mimeType}]`;
  }

  return JSON.stringify(part);
}

export function estimateMessageContentSize(content: ChatMessage["content"]): number {
  if (typeof content === "string") {
    return content.length;
  }

  return content.reduce((total, part) => total + toolResultPartToText(part).length, 0);
}
