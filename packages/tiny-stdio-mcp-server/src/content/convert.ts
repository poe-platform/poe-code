import type { ContentAnnotations } from "../types.js";
import { Image, type ImageContent } from "./image.js";
import { Audio, type AudioContent } from "./audio.js";
import { File, type EmbeddedResource } from "./file.js";
import type { ResourceLink } from "../types.js";
import { isJsonValue } from "toolcraft-schema";

export interface TextContent {
  type: "text";
  annotations?: ContentAnnotations;
  _meta?: Record<string, unknown>;
  text: string;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource | ResourceLink;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ToolReturn =
  | undefined
  | JsonPrimitive
  | JsonObject
  | Image
  | Audio
  | File
  | ContentBlock
  | Array<undefined | JsonPrimitive | JsonObject | Image | Audio | File | ContentBlock>;

function convertSingleValue(value: Exclude<ToolReturn, Array<unknown> | undefined>): ContentBlock {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { type: "text", text: String(value) };
  }

  if (value === null) {
    return { type: "text", text: "null" };
  }

  if (value instanceof Image) {
    return value.toContentBlock();
  }

  if (value instanceof Audio) {
    return value.toContentBlock();
  }

  if (value instanceof File) {
    return value.toContentBlock();
  }

  if (!isJsonValue(value)) {
    const content = Object.create(null, Object.getOwnPropertyDescriptors(value)) as object;
    if (isJsonValue(content) && isContentBlock(content)) return content;
    throw new TypeError("Tool return must be a JSON value or supported content helper");
  }

  if (isContentBlock(value)) {
    return value;
  }

  return { type: "text", text: JSON.stringify(value) };
}

export function toContentBlocks(result: ToolReturn): ContentBlock[] {
  const ancestors = new Set<object>();
  const frames: Array<{ value: ToolReturn; index: number }> = [{ value: result, index: 0 }];
  const blocks: ContentBlock[] = [];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const value = frame.value;
    if (value === undefined) { frames.pop(); continue; }
    if (!Array.isArray(value)) {
      frames.pop();
      blocks.push(convertSingleValue(value));
      continue;
    }
    if (frame.index === 0) {
      if (ancestors.has(value)) throw new TypeError("Cyclic tool result array");
      ancestors.add(value);
    }
    if (frame.index >= value.length) {
      ancestors.delete(value);
      frames.pop();
      continue;
    }
    const entry = Object.getOwnPropertyDescriptor(value, String(frame.index++));
    if (entry === undefined || !("value" in entry)) throw new TypeError("Tool result arrays must contain own data entries");
    frames.push({ value: entry.value, index: 0 });
  }
  return blocks;
}

function isContentBlock(value: object): value is ContentBlock {
  if (!hasOwnProperty(value, "type") || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "text") {
    return hasOwnProperty(value, "text") && typeof value.text === "string";
  }

  if (value.type === "image" || value.type === "audio") {
    return hasOwnProperty(value, "data")
      && typeof value.data === "string"
      && hasOwnProperty(value, "mimeType")
      && typeof value.mimeType === "string";
  }

  if (value.type === "resource_link") {
    return hasOwnProperty(value, "name") && typeof value.name === "string"
      && hasOwnProperty(value, "uri") && typeof value.uri === "string";
  }

  if (value.type !== "resource" || !hasOwnProperty(value, "resource")) {
    return false;
  }

  const resource = value.resource;
  return typeof resource === "object"
    && resource !== null
    && hasOwnProperty(resource, "uri")
    && typeof resource.uri === "string"
    && (!hasOwnProperty(resource, "mimeType") || typeof resource.mimeType === "string")
    && ((hasOwnProperty(resource, "text") && typeof resource.text === "string")
      || (hasOwnProperty(resource, "blob") && typeof resource.blob === "string"));
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
