export {
  readArchive,
  InputTypeError,
  InvalidValueError,
  ResourceLimitError,
  InvalidContainerError,
  CancellationError,
  type ArchiveLimits,
  type ArchiveContext,
  type ArchiveMember,
  type DocumentArchive
} from "./archive.js";
export { DocumentBudget, documentLimitDefaults, type DocumentLimits, type DocumentLimitName } from "./budget.js";
export {
  writeArchive,
  SinkError,
  type ArchiveWriteOptions,
  type ArchiveSink
} from "./archive-write.js";
export {
  readDocumentArchive,
  UnsupportedProfileError,
  InvalidPackageError,
  InvalidXmlError,
  type AdmittedDocumentArchive
} from "./admission.js";
export { normalizePartName, resolvePartTarget, relativePartTarget } from "./part-uri.js";
export type {
  DocumentPackage,
  PackagePart,
  PackageRelationship,
  ContentTypeDefault,
  ContentTypeOverride
} from "./package.js";
export {
  parseDocumentXml,
  parseDocumentXmlAsync,
  type DocumentXml,
  type DocumentXmlLimits,
  type XmlElement,
  type XmlContent,
  type XmlAttribute
} from "./package-xml.js";
export { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
export { DocumentArchiveEditor } from "./package-write.js";
export { documentDialects, type DocumentDialect } from "./dialect.js";
export { createDocumentArchive, createDocument, type DocumentCreateOptions, type CreateMutationData } from "./create.js";

export {
  MarkupCompatibility, documentCompatibilityProfile,
  type CompatibilityProfile, type CompatibilityElement, type CompatibilityContent,
  type CompatibilityBranch, type ExpandedXmlName
} from "./compatibility.js";

export { validateDocumentArchive, documentValidationProfile, SemanticValidationError, type ValidationOptions, type ValidationData, type ValidationDiagnostic } from "./validation.js";

export { writeDocumentArchive } from "./document-write.js";

export { DocumentIo, type DocumentByteSource, type DocumentIoContext } from "./io.js";

export {
  publishDocumentArchive, publishDocumentFiles, PublicationError,
  type PublicationInput, type PublicationOptions, type PublicationContext,
  type PublicationResult, type PublishedFile, type PublicationFile, type ExtractionPublicationOptions
} from "./publication.js";

export {
  encodeLocation, decodeLocation, SelectionError,
  type LocationPayload, type LocationKind, type LocationPositions, type Location,
  type PartLocation, type StoryLocation, type ParagraphLocation, type RunLocation,
  type TableLocation, type CellLocation, type ImageLocation, type AnnotationLocation
} from "./location-token.js";
export { documentScopes, type DocumentScope, type StoryReference } from "./location-index.js";
export {
  openDocumentLocations, type DocumentLocations,
  type LocationQuery, type MatchOptions, type LocationMutationOptions, type LocationAddress, type LocationUpdate,
  type LocationMutationResult, type LocationStage
} from "./locations.js";

export { DocxUsageError, parseDocxJson } from "./argument-json.js";
export {
  docxOperationSchemas, docxCommonOptions, validateDocxValue, assertDocxFields,
  type DocxOperationSchema, type DocxFieldSchema, type DocxOperationId
} from "./operation-schema.js";
export { docxValueSchema, getDocxOperationSchema, type DocxJsonSchema } from "./operation-json-schema.js";
export type {
  DocxOperationArguments, DocxOperationArgumentMap, DocxValidatedOperation,
  DocxBatchArgumentMap, DocxBatchItemMap, DocxBatchItem, DocxBatchOperationId,
  DocxBinaryInput, DocxVfsPath, DocxLength, DocxDirectLength, DocxModelHandle,
  DocxBindingRecord, DocxRunInput, DocxBlock, DocxContent, DocxTransportContext,
  DocxPageSettings, DocxStyleSettings, DocxThemeSettings,
  DocxXmlNode, DocxEnumValue, DocxEnumNames
} from "./operation-types.js";
export {
  parseDocxArguments, validateDocxInvocation, validateDocxBatch, createDocxCommandEngine, SourceError,
  type DocxInvocation, type DocxBatch, type DocxBatchOperation, type DocxArgumentSource,
  type DocxCommandRequest
} from "./command.js";
export { resolveDocxSelection } from "./simple-selection.js";
export { getDocxDiscovery, type DocxDiscovery, type DocxHelpData, type DocxSchemaData, type DocxCapabilitiesData, type DocxVersionData } from "./discovery.js";
export { inspectDocument, validateDocument, type InspectionData, type InspectionPart, type InspectionProperty, type InspectionFeature, type InspectionReference, type InspectionAnnotation, type InspectionProtection, type InspectionWarning } from "./inspection.js";
export { createDocxInspectionCommandEngine, type DocxInspectionCommandRequest } from "./inspection-command.js";
export { extractDocumentText, type TextOptions } from "./text.js";
export { replaceDocumentText, type TextReplaceOptions, type TextMutationData } from "./text-replace.js";
export { formatDocumentRuns, type RunFormatOptions, type RunFormatData } from "./run-format.js";
export { editDocumentParagraphs, type ParagraphEditRequest, type ParagraphEditOperation, type ParagraphEditData } from "./paragraph-edit.js";
export type { DocxTabStop, DocxParagraphBorder, DocxParagraphBorders, DocxParagraphShading } from "./operation-types.js";
export type { TextData, TextView, TextSegment, TextFormatting } from "./text-traversal.js";
export { getDocumentXml, replaceDocumentXmlPart, type XmlOptions, type XmlData, type XmlMutationData } from "./xml-parts.js";
export { inspectDocumentStyles, editDocumentStyles, type StyleEditOptions, type StyleInspectionOptions, type StyleInfo, type StyleInspectionData, type StyleMutationData } from "./styles.js";
export type { StyleProperties } from "./style-properties.js";

export { openDocumentStyleModel, Styles, BaseStyle, CharacterStyle, ParagraphStyle, TableStyle, _TableStyle, _NumberingStyle, LatentStyles, LatentStyle, _LatentStyle, WD_STYLE_TYPE } from "./styles-model.js";
export { Font, ParagraphFormat, TabStops, TabStop, ColorFormat, RGBColor, type FormattingXmlOwner } from "./formatting-model.js";
export { applyStyleModelBatch } from "./style-model-batch.js";
export { Length, Emu, Inches, Cm, Mm, Pt, Twips, WD_UNDERLINE, WD_COLOR_INDEX, WD_COLOR, WD_PARAGRAPH_ALIGNMENT, WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER, WD_BUILTIN_STYLE, WD_STYLE, MSO_THEME_COLOR, MSO_THEME_COLOR_INDEX, MSO_COLOR_TYPE, enumValue, enumFromValue, enumMembers, enumXml, enumFromXml, enumString } from "./formatting-values.js";

export type { FontResourceData, ThemeResource, FontTableResource, ThemeReference } from "./font-resources.js";
export { UnsupportedEmbeddedFontMutationError } from "./font-resources.js";

export { editDocumentSections, inspectDocumentSections, type SectionInfo, type SectionListData, type SectionEditRequest, type SectionEditData, type SectionBinding } from "./sections.js";
export { editDocumentStories, inspectDocumentStories, type StoryInfo, type StoryReadRequest, type StoryReadData, type StoryEditRequest, type StoryEditData } from "./stories.js";

export { editDocumentLists, type ListEditRequest, type ListEditOperation, type ListEditData } from "./lists.js";

export { type TableConstructionRequest } from "./paragraph-edit.js";
export { inspectDocumentTable, type TableInspectionData, type TableDetails } from "./table-read.js";
export { editDocumentTables, type TableEditRequest, type TableEditData, type TableEditOperation } from "./table-edit.js";
export type { DocxTableInput, DocxTableFormat, DocxTableBorders, DocxTableRowOptions, DocxCellInput, DocxCellMargins } from "./operation-types.js";
