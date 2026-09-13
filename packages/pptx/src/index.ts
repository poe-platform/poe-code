export type {
  BinaryInput,
  BinaryOutput,
  ByteContext,
  ByteLimits,
  ByteSink,
  ByteSource,
  Diagnostic,
  Location,
  OfficeResult,
  OperationRequest,
  Phase,
  ReadOptions,
  Scope,
  VfsCapability,
  VfsPath,
  WriteOptions
} from "./contracts.js";
export { OfficeError, type ByteErrorCode, type OfficeErrorCode } from "./errors.js";
export { selectionQuerySchema } from "./selector-schema.js";

export {
  readSelectionIndex,
  decodeSelectionToken,
  createBatchHandles,
  SelectionError,
  type SelectionContext,
  type SelectionQuery,
  type SelectionRecord,
  type SelectionIndex
} from "./selectors.js";

export {
  createPptxCommandEngine,
  type PptxCommandEngine,
  type PptxCommandEngineOptions,
  type PptxCommandRequest,
  type PptxCommandOutput
} from "./command-engine.js";
