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
export type { PresentationInventory, SlideInventory, PartInventory } from "./inventory.js";

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
  type PptxCommandOutput,
  type PptxPublicationRequest
} from "./command-engine.js";

export { getXmlPart, replaceXmlPart, type XmlPartContext, type XmlPartData } from "./xml-parts.js";

export {
  createPresentation,
  type CreatePresentationOptions,
  type PresentationProperties,
  type PresentationSlideInput,
  type PresentationTextShape
} from "./creation.js";

export {
  addSlide,
  mutateSlides,
  type MutateSlidesOptions,
  type AddSlideOptions,
  type PlaceholderText
} from "./slides.js";

export { removeSlides, type RemoveSlidesOptions } from "./slide-removal.js";

export { duplicateSlides, type DuplicateSlidesOptions } from "./slide-copy.js";

export { importSlides, type ImportSlidesOptions } from "./slide-import.js";
