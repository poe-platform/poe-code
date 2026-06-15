// MIME detection
export { fileTypeFromBuffer, type FileTypeResult } from "./mime.js";
export { DEFAULT_FROM_URL_MAX_BYTES } from "./remote.js";
export type { FromUrlOptions } from "./remote.js";

// Content helpers
export { Image, type ImageContent } from "./image.js";
export { Audio, type AudioContent } from "./audio.js";
export {
  File,
  type EmbeddedResource,
  type TextResourceContents,
  type BlobResourceContents,
} from "./file.js";

// Conversion utility
export {
  toContentBlocks,
  type ContentBlock,
  type TextContent,
  type ToolReturn,
} from "./convert.js";
