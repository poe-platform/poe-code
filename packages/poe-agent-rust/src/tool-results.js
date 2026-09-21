import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isToolResultPart(value) {
  return isObjectRecord(value) && native.probeToolResultPart(value);
}
export function getStructuredToolResultParts(value) {
  if (isToolResultPart(value)) {
    return [value];
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every(isToolResultPart)) {
    return undefined;
  }
  return value;
}
export function normalizeToolResult(value) {
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
export function toToolMessageContent(value) {
  const normalized = normalizeToolResult(value);
  if (typeof normalized === "string") {
    return normalized;
  }
  if (!Array.isArray(normalized) && normalized.type === "text") {
    return normalized.text;
  }
  return Array.isArray(normalized) ? normalized : [normalized];
}
export function toolResultPartToText(part) {
  if (part.type === "text") {
    return part.text;
  }
  if (part.type === "image") {
    return native.toolResultImageText(`${part.mimeType}`);
  }
  return JSON.stringify(part);
}
export function estimateMessageContentSize(content) {
  if (typeof content === "string") {
    return content.length;
  }
  return content.reduce((total, part) => total + toolResultPartToText(part).length, 0);
}
