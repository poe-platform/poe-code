import { Image, type ImageContent } from "./image.js";
import { Audio, type AudioContent } from "./audio.js";
import { File, type EmbeddedResource } from "./file.js";

export interface TextContent {
  type: "text";
  text: string;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource;

export type ToolReturn =
  | string
  | Image
  | Audio
  | File
  | ContentBlock
  | Array<string | Image | Audio | File | ContentBlock>;

function convertSingleValue(value: string | Image | Audio | File | ContentBlock): ContentBlock {
  if (typeof value === "string") {
    return { type: "text", text: value };
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

  // Already a ContentBlock
  return value;
}

export function toContentBlocks(result: ToolReturn): ContentBlock[] {
  if (Array.isArray(result)) {
    return result.flatMap((item) => toContentBlocks(item));
  }

  return [convertSingleValue(result)];
}
