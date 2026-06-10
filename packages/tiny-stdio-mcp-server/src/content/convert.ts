import { Image, type ImageContent } from "./image.js";
import { Audio, type AudioContent } from "./audio.js";
import { File, type EmbeddedResource } from "./file.js";

export interface TextContent {
  type: "text";
  text: string;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource;

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

  if (isContentBlock(value)) {
    return value;
  }

  return { type: "text", text: JSON.stringify(value) };
}

export function toContentBlocks(result: ToolReturn): ContentBlock[] {
  if (result === undefined) {
    return [];
  }

  if (Array.isArray(result)) {
    return result.flatMap((item) => toContentBlocks(item));
  }

  return [convertSingleValue(result)];
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
