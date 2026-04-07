export type {
  BaseLayer,
  ChainLayer,
  DataLayer,
  DocumentLayer,
  FileSystem,
  ParsedDocument,
  ResolvedDocument,
  ResolveOptions
} from "./types.js";
export type { DiscoveredBase } from "./discover.js";
export { findBase } from "./discover.js";
export { parseDocument } from "./parse.js";
export { mergeLayers } from "./merge.js";

export { resolve } from "./resolve.js";
