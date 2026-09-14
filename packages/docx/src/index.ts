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
export { createDocumentArchive, type DocumentCreateOptions } from "./create.js";

export {
  MarkupCompatibility, documentCompatibilityProfile,
  type CompatibilityProfile, type CompatibilityElement, type CompatibilityContent,
  type CompatibilityBranch, type ExpandedXmlName
} from "./compatibility.js";

export { validateDocumentArchive, documentValidationProfile, SemanticValidationError, type ValidationOptions, type ValidationData, type ValidationDiagnostic } from "./validation.js";

export { writeDocumentArchive } from "./document-write.js";
