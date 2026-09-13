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

export {
  mergeSlides,
  splitSlides,
  type MergeSlidesOptions,
  type SplitSlidesOptions,
  type SplitSlideOutput
} from "./slide-merge-split.js";

export {
  readMemberships,
  mutateMemberships,
  type MembershipKind,
  type MembershipRecord,
  type MembershipSelection,
  type MutateMembershipsOptions
} from "./memberships.js";

export {
  readPresentationSettings,
  mutatePresentationSettings,
  type PresentationSettings,
  type MutatePresentationSettingsOptions
} from "./presentation-settings.js";

export {
  readMasters,
  addMaster,
  mutateMaster,
  associateLayout,
  mutateMasterShape,
  type MasterRecord,
  type SharedEditResult,
  type MasterBackground,
  type AddMasterOptions,
  type MutateMasterOptions,
  type AssociateLayoutOptions,
  type MutateMasterShapeOptions
} from "./masters.js";

export {
  readLayouts,
  addLayout,
  mutateLayout,
  removeLayout,
  applyLayout,
  type LayoutRecord,
  type LayoutPlaceholder,
  type LayoutPlaceholderRecord,
  type AddLayoutOptions,
  type MutateLayoutOptions,
  type RemoveLayoutOptions,
  type ApplyLayoutOptions
} from "./layouts.js";

export type { EffectiveStyleValue, StyleSource, TextStyleRecord } from "./text-style-resolution.js";

export { readThemes, mutateTheme, type ThemeRecord, type MutateThemeOptions } from "./themes.js";
export {
  readBackgrounds,
  mutateBackground,
  type BackgroundRecord,
  type BackgroundScope,
  type GradientStop,
  type MutateBackgroundOptions
} from "./backgrounds.js";

export {
  readPresentationText,
  type ReadPresentationTextOptions,
  type TextScope,
  type TextInline,
  type TextParagraph,
  type TextSegment,
  type PresentationText
} from "./text-reading.js";

export {
  replacePresentationText,
  type ReplacePresentationTextOptions,
  type TextReplacementResult
} from "./text-replacement.js";

export {
  MSO_TEXT_UNDERLINE_TYPE,
  MSO_UNDERLINE,
  readTextRuns,
  mutateTextRuns,
  validateTextRunOptions,
  textUnderlineStyles,
  textStrikeStyles,
  textCapitalizationStyles,
  type MutateTextRunsOptions,
  type TextRunFormatting
} from "./text-runs.js";

export {
  ColorFormat,
  RGBColor,
  ColorPropertyAccessError,
  type RunColor,
  type RunColorRecord
} from "./text-run-color.js";

export {
  Paragraph,
  PP_PARAGRAPH_ALIGNMENT,
  PP_ALIGN,
  paragraphAlignments,
  paragraphNumberingSchemes,
  readTextParagraphs,
  mutateTextParagraphs,
  validateTextParagraphOptions,
  type TextParagraphFormatting,
  type MutateTextParagraphsOptions,
  type ParagraphSpacing,
  type ParagraphBullet,
  type ParagraphTab
} from "./text-paragraphs.js";

export { Length, Emu, Inches, Cm, Mm, Pt, Centipoints } from "./length.js";

export {
  TextFrame,
  MSO_AUTO_SIZE,
  MSO_VERTICAL_ANCHOR,
  MSO_ANCHOR,
  textVerticalModes,
  readTextFrames,
  mutateTextFrames,
  validateTextFrameOptions,
  type TextFrameFormatting,
  type MutateTextFramesOptions
} from "./text-frames.js";
