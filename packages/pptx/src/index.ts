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
export {
  readAnimations,
  type AnimationRecord,
  type AnimationNode,
  type AnimationDiagnostic,
  type AnimationTimingReference
} from "./animations.js";
export { readTransitions, mutateTransitions, validateTransitionOptions, type TransitionKind, type TransitionDirection, type TransitionRecord, type MutateTransitionsOptions } from "./transitions.js";
export {
  readCharts,
  inspectChart,
  type ChartSelection,
  type ChartXmlNode,
  type ChartPoint,
  type ChartDataSource,
  type ChartSeries,
  type ChartPlot,
  type ChartAxis,
  type ChartInspection,
  type ChartLink,
  type ChartRecord
} from "./charts.js";
export {
  addChart,
  setCharts,
  chartTypes,
  type CreatableChartType,
  type ChartInputSeries,
  type ChartData,
  type ChartUpdate,
  type AddChartOptions
} from "./chart-editing.js";
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

export { admitFontMetrics, type FontMetrics, type FontMetricsHandle } from "./font-metrics.js";
export {
  fitTextFrames,
  type TextFitOptions,
  type ModelTextFitOptions,
  type FitTextFramesOptions
} from "./text-fitting.js";

export {
  readFields,
  mutateFields,
  type FieldKind,
  type FieldUpdate,
  type MutateFieldsOptions
} from "./fields.js";

export {
  FillFormat,
  LineFormat,
  ShapeColorFormat,
  Shape,
  readShape,
  createShapeXml,
  applyShapeUpdate,
  validateShapeOptions,
  MSO_AUTO_SHAPE_TYPE,
  MSO_SHAPE,
  shapePresets,
  type ShapeKind,
  type ShapeLength,
  type ShapeUpdate,
  type ShapeRecord
} from "./shapes.js";
export { readShapes, addShape, mutateShapes, type ShapeSelection } from "./shape-operations.js";
export { readShapeGeometry, type ShapeGeometry } from "./shape-transforms.js";
export { PP_PLACEHOLDER_TYPE, PP_PLACEHOLDER } from "./shape-placeholder-types.js";

export { MSO_SHAPE_TYPE } from "./shape-types.js";

export {
  validateShapePath,
  pathFromVertices,
  readShapePath,
  applyShapePath,
  shapePathXml,
  type ShapePath,
  type ShapePathCommand
} from "./shape-paths.js";
export {
  addShapePath,
  setShapePath,
  readShapePaths,
  type AddShapePathOptions,
  type SetShapePathOptions
} from "./shape-path-operations.js";

export {
  groupShapes,
  ungroupShape,
  type GroupShapesOptions,
  type UngroupShapeOptions
} from "./shape-groups.js";

export {
  mutateShapeSelection,
  applyShapeSelection,
  validateShapeSelectionOptions,
  type ShapeSelectionOptions,
  type ShapeSelectionAction,
  type ShapeOrder,
  type ShapeAlignment,
  type ShapeAxis
} from "./shape-selection.js";
export {
  MSO_CONNECTOR_TYPE,
  MSO_CONNECTOR,
  createConnectorXml,
  applyConnectorUpdate,
  readConnector,
  validateConnectorUpdate,
  removeDrawingObjects,
  type ConnectorKind,
  type ConnectorUpdate
} from "./connectors.js";
export {
  readConnectors,
  addConnector,
  mutateConnectors,
  removeConnectors,
  removeShapes,
  validateConnectorOptions
} from "./connector-operations.js";
export { Connector } from "./connectors-model.js";

export { readDrawing, mutateDrawing } from "./drawing-operations.js";
export {
  applyDrawingUpdate,
  readDrawingFormat,
  validateDrawingUpdate,
  patternPresets,
  dashPresets,
  type DrawingUpdate,
  type DrawingFill,
  type DrawingColor
} from "./drawing-format.js";

export {
  MSO_FILL,
  MSO_FILL_TYPE,
  MSO_LINE,
  MSO_LINE_DASH_STYLE,
  MSO_PATTERN,
  MSO_PATTERN_TYPE
} from "./drawing-enums.js";
export {
  GradientStop as DrawingGradientStop,
  GradientStop as _GradientStop,
  GradientStops,
  GradientStops as _GradientStops,
  ShadowFormat
} from "./shapes.js";

export {
  readTables,
  addTable,
  mutateTables,
  restructureTables,
  type TableSelection
} from "./table-operations.js";
export {
  readTable,
  createTableXml,
  applyTableUpdate,
  validateTableUpdate,
  type TableUpdate,
  type TableRecord
} from "./tables.js";
export {
  Table,
  TableCell,
  TableRow,
  TableColumn,
  TableRows,
  TableColumns,
  TableCells
} from "./tables-model.js";

export {
  applyTableStructure,
  type TableCoordinate,
  type TableStructureOperation
} from "./table-spans.js";

export {
  readImages,
  type ReadImagesOptions,
  type ImageOccurrence,
  type ImageMedia,
  type ImageInventory
} from "./images.js";

export { addImage, type AddImageOptions } from "./image-insertion.js";

export {
  setImage,
  applyPictureUpdate,
  type SetImageOptions,
  type SetImageResult
} from "./image-formatting.js";
export { extractImages } from "./image-extraction.js";
export type { ExtractImagesOptions, ExtractedImage } from "./image-extraction.js";

export {
  readEquations,
  mutateEquations,
  inventoryEquations,
  validateAuthoredEquation,
  type EquationContent,
  type EquationRecord,
  type AddEquationOptions
} from "./equations.js";

export {
  readMedia,
  type ReadMediaOptions,
  type MediaRelationship,
  type MediaMetadata,
  type MediaOccurrence,
  type MediaPart,
  type MediaInventory
} from "./media.js";

export { extractMedia, type ExtractMediaOptions, type ExtractedMedia } from "./media-extraction.js";
export {
  addMedia,
  replaceMedia,
  type AddMediaOptions,
  type ReplaceMediaOptions,
  type ReplaceMediaResult,
  type MediaPoster
} from "./media-editing.js";
