import { styleFontFlags } from "./style-properties.js";
import type { DocxJsonSchema } from "./operation-json-schema.js";

const string: DocxJsonSchema = { type: "string" };
const strings: DocxJsonSchema = { type: "array", items: string };
const empty: DocxJsonSchema = { type: "array", maxItems: 0 };
function object(properties: Readonly<Record<string, DocxJsonSchema>>): DocxJsonSchema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
function result(operation: string, data: DocxJsonSchema): DocxJsonSchema {
  return { oneOf: [object({ version: { const: 1 }, operation: { const: operation }, ok: { const: true }, data,
    warnings: empty, errors: empty, affected: { const: 0 }, locations: empty }), discoveryFailureSchema(operation)] };
}

export function discoveryFailureSchema(operation: string): DocxJsonSchema {
  return object({ version: { const: 1 }, operation: { const: operation }, ok: { const: false }, data: { type: "null" },
    warnings: empty, errors: { type: "array", minItems: 1, items: object({
      code: { enum: ["usage", "limit-exceeded", "source-failure", "sink-failure", "cancelled"] }, message: string
    }) }, affected: { const: 0 }, locations: empty });
}

export const discoveryResultSchemas = {
  help: result("help", object({ name: { const: "docx" }, paths: { type: "array", items: object({
    path: strings, usage: string, description: string, operationIds: strings
  }) } })),
  schema: result("schema", object({ schemaVersion: { const: 1 }, validationProfiles: { type: "array", items: { type: "object" } }, operations: { type: "array", items: object({
    id: string, path: strings, input: { type: "object" }, result: { type: "object" }, featureIds: strings,
    support: { enum: ["edit", "read", "preserve", "reject"] }
  }) } })),
  capabilities: result("capabilities", object({ features: { type: "array", items: object({ id: string, level: { enum: ["read", "edit", "preserve", "reject"] }, subsets: { type: "array", items: object({ name: string, level: { enum: ["read", "edit", "preserve", "reject"] }, reason: string }) }, detected: { type: "null" } }) }, host: object({
    read: { const: false }, atomicReplace: { const: false }, transactions: { const: false }, binaryStdout: { const: true }
  }), validationProfiles: { type: "array", items: { type: "object" } }, limits: { type: "array", items: object({ name: string, ceiling: { type: "integer", minimum: 0 } }) } })),
  version: result("version", object({ name: { const: "docx" }, version: string, schemaVersion: { const: 1 } }))
};

const number: DocxJsonSchema = { type: "integer", minimum: 0 };
const nullableString: DocxJsonSchema = { oneOf: [string, { type: "null" }] };
const boolean: DocxJsonSchema = { type: "boolean" };
const nullableBoolean: DocxJsonSchema = { oneOf: [boolean, { type: "null" }] };
const array = (items: DocxJsonSchema): DocxJsonSchema => ({ type: "array", items });
const diagnostic = object({ code: string, message: string });
const part = object({ name: string, contentType: string, bytes: number, sha256: string });
const reference = object({ owner: string, id: string, type: string, target: string, external: boolean });
const location: DocxJsonSchema = object({ kind: string, token: string, value: { type: "object" }, positions: { type: "object" } });
const resourcePartLocation = object({ kind: { const: "part" }, token: string, value: object({ version: { const: 1 }, sourceSha256: string, generation: number, part: string, story: string, path: { type: "array", maxItems: 0 }, range: { type: "null" } }), positions: object({}) });
const locatedDiagnostic: DocxJsonSchema = { ...object({ code: string, message: string, location: string }), required: ["code", "message"] };
const diagramIssue = object({ code: string, part: string, path: array(number), message: string });
const diagramRole: DocxJsonSchema = { enum: ["data", "layout", "style", "color", "drawing"] };
const diagramBinding = object({ role: diagramRole, attribute: string, relationshipId: nullableString,
  reference: { oneOf: [reference, { type: "null" }] }, status: { enum: ["internal", "external", "missing-id", "missing-relationship", "wrong-relationship-type", "wrong-resource-type", "opaque"] },
  target: { oneOf: [part, { type: "null" }] }, issues: array(diagramIssue) });
const diagramDetails = object({ kind: { const: "diagrams" }, parts: array(part),
  roles: array(object({ role: diagramRole, part: string, evidence: { enum: ["content-type", "relationship", "both"] },
    root: { oneOf: [object({ namespace: string, localName: string }), { type: "null" }] }, status: { enum: ["matching", "opaque"] } })),
  observations: array(object({ kind: { enum: ["relIds", "unknown-graphic", "extension"] }, part: string, path: array(number), namespace: string, localName: string,
    uri: nullableString, active: boolean, bindings: array(diagramBinding), issues: array(diagramIssue) })), issues: array(diagramIssue) });
const diagramRecord = object({ kind: { const: "diagrams" }, location: resourcePartLocation, name: string, properties: empty,
  references: array(reference), support: { const: "preserve" }, details: diagramDetails });
export const diagramOperationContracts: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = {
  "diagrams.list": { description: "Inventory package-global physical diagram role parts and eligible opaque graphics observations, including orphan parts and inactive alternatives. Preserve-only snapshots retain inert bindings and graph references. No layout activation, rendering, external acquisition or semantic editing. Utility batch execution and live diagram models remain unsupported.",
    featureIds: ["F38"], result: { oneOf: [
      object({ version: { const: 1 }, operation: { const: "diagrams.list" }, ok: { const: true }, data: object({ items: array(diagramRecord) }), warnings: array(diagnostic), errors: empty, affected: { const: 0 }, locations: array(resourcePartLocation) }),
      object({ version: { const: 1 }, operation: { const: "diagrams.list" }, ok: { const: false }, data: { type: "null" }, warnings: empty, errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: empty })
    ] } }
};
const customXmlDetails = object({ kind: { const: "custom-xml" }, parts: array(part), root: { oneOf: [object({ namespace: string, localName: string }), { type: "null" }] }, storeItemId: nullableString, propertiesParts: strings, namespaces: array(object({ prefix: string, uri: string })), schemaReferences: strings });
const glossaryDetails = object({ kind: { const: "glossary" }, parts: array(part), buildingBlocks: array(object({ path: array(number), name: nullableString, guid: nullableString, category: nullableString, gallery: nullableString, types: strings, behaviors: strings })) });
const customXmlData = object({ items: array(object({ kind: { const: "custom-xml" }, location: resourcePartLocation, name: string, properties: empty, references: array(reference), support: { const: "preserve" }, details: customXmlDetails })) });
const glossaryData = object({ items: array(object({ kind: { const: "glossary" }, location: resourcePartLocation, name: string, properties: empty, references: array(reference), support: { const: "preserve" }, details: glossaryDetails })) });
const settingEntry = object({ path: array(number), namespace: string, localName: string, attributes: array(object({ namespace: string, localName: string, value: string })), status: { enum: ["stored", "opaque"] } });
const settingsData = object({ items: array(object({ kind: { const: "settings" }, location: resourcePartLocation, name: string, properties: empty, references: empty, support: { enum: ["read", "preserve"] }, details: object({ kind: { const: "settings" }, entries: array(settingEntry), updateFields: nullableBoolean, fontEmbedding: object({ embedTrueTypeFonts: nullableBoolean, embedSystemFonts: nullableBoolean, saveSubsetFonts: nullableBoolean }), protection: array(object({ kind: string, enforced: nullableBoolean, edit: nullableString })) }) })) });
const property = object({ name: string, type: { enum: ["string", "boolean", "integer", "number", "date"] }, value: { oneOf: [string, boolean, { type: "number" }, { type: "null" }] }, writable: boolean, cached: boolean, part: string, group: { enum: ["core", "extended", "custom"] } });
const fontResources = object({
  themes: array(object({ part: string, name: nullableString,
    colors: array(object({ slot: string, kind: string, value: nullableString, lastColor: nullableString })),
    fonts: array(object({ family: { enum: ["major", "minor"] }, slot: string, script: nullableString, typeface: nullableString })) })),
  fontTables: array(object({ part: string, fonts: array(object({ name: nullableString, alternateName: nullableString, charset: nullableString, family: nullableString, pitch: nullableString,
    embedded: array(object({ kind: string, id: nullableString, fontKey: nullableString, subsetted: nullableString, target: nullableString, status: { enum: ["resolved", "invalid-font-reference"] } })) })) })),
  references: array(object({ part: string, path: array(number), attribute: string, value: string, resource: nullableString,
    status: { enum: ["resolved", "missing-theme", "invalid-theme-reference", "missing-theme-slot"] } })),
  languages: array(object({ part: string, values: { type: "object", additionalProperties: string } })),
  colorMappings: array(object({ part: string, values: { type: "object", additionalProperties: string } })),
  diagnostics: array(object({ code: string, part: string, message: string })),
  availability: { type: "null" }, licensing: { type: "null" }, embeddedFontMutation: { const: "unsupported" }
});
const inspectionData = object({
  fontResources,
  kind: { enum: ["docx", "dotx"] }, dialect: { enum: ["strict", "transitional"] }, parts: array(part), relationships: array(reference),
  contentTypes: object({ defaults: array(object({ extension: string, contentType: string })), overrides: array(object({ name: string, contentType: string })) }),
  stories: array(object({ kind: string, location, properties: array(property), references: array(reference), support: { const: "read" } })), properties: array(property),
  features: array(object({ id: string, level: { enum: ["read", "preserve"] }, subsets: array(object({ name: string, level: { enum: ["read", "preserve"] }, reason: string })), detected: boolean })),
  counts: object({ ...Object.fromEntries(["paragraphs", "runs", "tables", "rows", "cells", "images", "sections", "comments", "footnotes", "endnotes", "fields", "controls", "equations"].map(name => [name, number])), cachedPages: { oneOf: [number, { type: "null" }] } }),
  sizes: object({ archiveBytes: number, expandedBytes: number, mediaBytes: number }),
  signed: boolean, protected: boolean, pages: object({ rendered: { type: "null" }, cachedBreaks: number }),
  fonts: object({ references: strings, themeReferences: strings, embedded: strings, installed: { type: "null" } }), signatures: object({ parts: strings, verified: { type: "null" } }), media: array(part),
  annotations: array(object({ part: string, kind: string, id: nullableString, author: nullableString, date: nullableString })),
  protection: array(object({ part: string, kind: string, enforced: nullableBoolean, edit: nullableString })), warnings: array(diagnostic)
});
const validationData = object({ valid: boolean, profile: { const: "core-v1" }, checks: array(object({ id: string, status: { enum: ["passed", "failed", "unvalidated"] } })), diagnostics: array(object({ code: string, part: string, location: string, message: string })), warnings: strings });
const xmlData = object({ part: string, encoding: { enum: ["base64", "utf-8"] }, content: string, pretty: boolean, bytes: number, sha256: string });
const mutationData = object({ changed: boolean, changes: array(object({ kind: { const: "replace" }, before: location, after: location })),
  output: { oneOf: [object({ path: nullableString, bytes: number, sha256: string }), { type: "null" }] }, dryRun: boolean });
const equationLocation = object({ kind: { const: "part" }, token: string, value: object({ version: { const: 1 }, sourceSha256: string, generation: number, part: string, story: string, path: array(number), range: { type: "null" } }), positions: object({}) });
const equationIssue = object({ code: string, part: string, path: array(number), message: string });
const equationProperty = object({ scope: { enum: ["equation", "run", "argument", "display", "global"] }, part: string, path: array(number), namespace: string, localName: string,
  attributes: array(object({ namespace: string, localName: string, value: string })), status: { enum: ["stored", "opaque"] }, issues: array(equationIssue) });
const equationDetails = object({ kind: { const: "equations" }, mode: { enum: ["inline", "display"] }, ownerPart: string,
  root: object({ namespace: string, localName: string }), path: array(number), mathPaths: array(array(number)), active: boolean,
  properties: array(equationProperty), status: { enum: ["bounded", "opaque"] }, issues: array(equationIssue) });
const equationRecord = object({ kind: { const: "equations" }, location: equationLocation, name: string, properties: empty, references: array(reference), support: { enum: ["edit", "preserve"] }, details: equationDetails });
export const equationOperationContracts: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = Object.fromEntries(
  ["equations.list", "equations.add", "equations.replace"].map(id => [id, {
    description: id === "equations.list" ? "Read package-global physical outer OMML units and inert stored/global properties, including inactive and opaque storage. Explicit bounded fragment edits are separate; full math models, evaluation, layout, rendering and utility batch execution remain unsupported."
      : "Edit one explicit current whole-paragraph add or physical-unit replacement using a matching-dialect bounded OMML fragment. Preserve adjacent/inactive/opaque content; full schema, math models, evaluation, conversion, layout, rendering and utility batch execution remain unsupported.",
    featureIds: ["F39"], result: { oneOf: [
      object({ version: { const: 1 }, operation: { const: id }, ok: { const: true },
        data: id === "equations.list" ? object({ items: array(equationRecord), globalProperties: array(equationProperty) })
          : object({ ...mutationData.properties, changes: { ...array(object({ kind: { const: id === "equations.add" ? "add" : "replace" }, before: location, after: equationLocation })), maxItems: 1 } }),
        warnings: array(diagnostic), errors: empty, affected: id === "equations.list" ? { const: 0 } : { enum: [0, 1] }, locations: id === "equations.list" ? array(equationLocation) : { ...array(equationLocation), maxItems: 1 } }),
      object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: locatedDiagnostic }, affected: { const: 0 }, locations: array(location) })
    ] }
  }])
);
const propertyValue = object({ name: string, type: { enum: ["string", "boolean", "integer", "number", "date"] }, value: { oneOf: [string, boolean, { type: "number" }, { type: "null" }] }, writable: boolean, cached: boolean });
const propertyRecord: DocxJsonSchema = { ...object({ kind: { const: "property" }, location: resourcePartLocation, name: string, properties: { type: "array", maxItems: 1, items: propertyValue }, references: array(reference), support: { enum: ["edit", "read", "preserve"] }, details: object({ kind: { const: "property" }, group: { enum: ["core", "extended", "custom"] }, storedType: { oneOf: [object({ namespace: string, localName: string }), { type: "null" }] }, id: nullableString }) }), required: ["kind", "location", "properties", "references", "support", "details"] };
const nullablePartLocation: DocxJsonSchema = { oneOf: [resourcePartLocation, { type: "null" }] };
const propertyMutationData = object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["add", "set", "remove", "replace"] }, before: nullablePartLocation, after: nullablePartLocation })) });
const imageNumber: DocxJsonSchema = { oneOf: [{ type: "number" }, { type: "null" }] };
const imagePosition: DocxJsonSchema = { oneOf: [object({ relativeFrom: nullableString, offsetEmu: { oneOf: [{ type: "integer" }, { type: "null" }] }, alignment: nullableString }), { type: "null" }] };
const imageDetails = object({ kind: { const: "images" }, part: nullableString, mime: nullableString, declaredMime: nullableString,
  bytes: { oneOf: [number, { type: "null" }] }, sha256: nullableString, pixelWidth: imageNumber, pixelHeight: imageNumber,
  widthEmu: imageNumber, heightEmu: imageNumber, placement: { oneOf: [{ enum: ["inline", "floating"] }, { type: "null" }] },
  crop: { oneOf: [object({ left: { type: "number" }, right: { type: "number" }, top: { type: "number" }, bottom: { type: "number" } }), { type: "null" }] },
  rotation: imageNumber, flipHorizontal: nullableBoolean, flipVertical: nullableBoolean,
  wrap: { oneOf: [{ enum: ["none", "square", "tight", "through", "top-bottom"] }, { type: "null" }] }, zOrder: imageNumber,
  horizontalPosition: imagePosition, verticalPosition: imagePosition, alt: nullableString, decorative: nullableBoolean,
  wrapText: { oneOf: [{ enum: ["bothSides", "left", "right", "largest"] }, { type: "null" }] },
  wrapPolygon: { oneOf: [object({ start: object({ x: { type: "integer", minimum: -27273042329600, maximum: 27273042316900 }, y: { type: "integer", minimum: -27273042329600, maximum: 27273042316900 } }), lineTo: { type: "array", minItems: 2, items: object({ x: { type: "integer", minimum: -27273042329600, maximum: 27273042316900 }, y: { type: "integer", minimum: -27273042329600, maximum: 27273042316900 } }) } }), { type: "null" }] },
  distances: { oneOf: [object({ top: imageNumber, bottom: imageNumber, left: imageNumber, right: imageNumber }), { type: "null" }] },
  allowOverlap: nullableBoolean, behindText: nullableBoolean, lockAspect: nullableBoolean,
  owners: array(location), fallbackPart: nullableString, alternateParts: strings, linked: boolean });
const imageRecord: DocxJsonSchema = { ...object({ kind: { const: "images" }, location, name: string, properties: empty,
  references: array(reference), support: { enum: ["read", "preserve"] }, details: imageDetails }), required: ["kind", "location", "properties", "references", "support", "details"] };
const imageExtractionData = object({ complete: boolean, inventory: { type: "null" },
  manifest: { oneOf: [object({ path: string, bytes: number, sha256: string, published: boolean }), { type: "null" }] },
  entries: array(object({ path: string, part: string, bytes: number, sha256: string, locations: array(location), published: boolean })) });
export const rasterReplacementOperationContracts: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = {
  "images.replace": {
    description: "Replace one embedded raster image; explicit shared intent replaces its shared media resource and preserves drawing properties.",
    featureIds: ["F32", "F35"],
    result: { oneOf: [object({ version: { const: 1 }, operation: { const: "images.replace" }, ok: { const: true },
      data: object({ ...mutationData.properties, changes: array(object({ kind: { const: "replace" }, before: location, after: location })) }),
      warnings: empty, errors: empty, affected: number, locations: array(location) }), object({ version: { const: 1 }, operation: { const: "images.replace" }, ok: { const: false },
      data: { type: "null" }, warnings: empty, errors: array(diagnostic), affected: { const: 0 }, locations: empty })] }
  }
};
export const imageLayoutOperationContracts: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = {
  "images.set": {
    description: "Edit admitted stored native picture layout and metadata; preserve media and owner-local relationships exactly.",
    featureIds: ["F33"],
    result: { oneOf: [object({ version: { const: 1 }, operation: { const: "images.set" }, ok: { const: true },
      data: object({ ...mutationData.properties, changes: array(object({ kind: { const: "set" }, before: location, after: location })) }),
      warnings: empty, errors: empty, affected: number, locations: array(location) }), object({ version: { const: 1 }, operation: { const: "images.set" }, ok: { const: false },
      data: { type: "null" }, warnings: empty, errors: array(diagnostic), affected: { const: 0 }, locations: empty })] }
  }
};
const shapeDetails = object({ representation: { enum: ["native", "office", "vml"] }, kind: { enum: ["shape", "group"] },
  containingGroup: { oneOf: [location, { type: "null" }] }, textBoxStories: array(location), ownerPart: string,
  sectionReferences: array(object({ section: number, variant: { enum: ["default", "first", "even"] }, story: string, part: string })),
  editSupport: { enum: ["supported", "unsupported"] }, refusalReasons: strings, watermarkEvidence: strings });
const shapeRecord: DocxJsonSchema = { ...object({ kind: { const: "shape" }, location, name: string, properties: empty,
  references: array(reference), support: { enum: ["edit", "preserve"] }, details: shapeDetails }),
  required: ["kind", "location", "properties", "references", "support", "details"] };
export const shapeOperationContracts = Object.fromEntries([
  ["shapes.list", "Inventory active native, Office and VML shapes and groups in story order, retaining carrier hierarchy, text-box story owners and physical section references. Stored watermark-like evidence is not rendering or visibility. Inactive MCE alternatives remain preservation evidence.", object({ items: array(shapeRecord) })],
  ["shapes.set", "Replace the whole text of an admitted simple ungrouped text box, preserving paragraph properties and shape geometry while replacing run formatting. Explicit shape/token/all selection; nested, linked, opaque and shared-header edits reject. Utility batch and geometry models remain unsupported.", mutationData]
].map(([id, description, data]) => [id, { description, featureIds: ["F36"], result: { oneOf: [
  object({ version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema,
    warnings: id === "shapes.list" ? array(diagnostic) : empty, errors: empty, affected: id === "shapes.list" ? { const: 0 } : number, locations: array(location) }),
  object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: { type: "null" },
    warnings: empty, errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: empty })
] } }])) as Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>>;
const chartPath = array(number);
const chartIssue = object({ code: string, part: string, path: chartPath, message: string });
const chartPoint = object({ path: chartPath, index: nullableString, values: array(nullableString), issues: array(chartIssue) });
const chartCache = object({ kind: { enum: ["string", "numeric", "multilevel-string"] }, path: chartPath,
  cached: boolean, freshness: { enum: ["unknown", null] }, counts: array(nullableString), formatCodes: array(nullableString),
  points: array(chartPoint), levels: array(object({ path: chartPath, points: array(chartPoint) })), issues: array(chartIssue) });
const chartSource = object({ role: { enum: ["label", "category", "value", "x", "y", "bubble"] }, namespace: string,
  localName: string, path: chartPath, kind: { enum: ["literal", "reference", "opaque"] }, literals: array(nullableString),
  formulas: array(nullableString), caches: array(chartCache), issues: array(chartIssue) });
const chartSeries = object({ group: number, path: chartPath, indices: array(nullableString), orders: array(nullableString),
  name: nullableString, label: object({ provenance: { enum: ["literal", "cached", "missing", "ambiguous", "opaque"] } }),
  cachedValues: array(nullableString), sources: array(chartSource), issues: array(chartIssue) });
const chartBinding = object({ role: { enum: ["workbook", "style", "color"] }, relationshipId: nullableString,
  reference: { oneOf: [reference, { type: "null" }] }, status: { enum: ["internal", "external", "missing-id", "missing-relationship", "wrong-relationship-type", "wrong-resource-type", "opaque"] },
  target: { oneOf: [part, { type: "null" }] }, issues: array(chartIssue) });
const chartDetails = object({ kind: { const: "charts" }, definition: part, root: object({ namespace: string, localName: string }),
  status: { enum: ["decoded", "opaque"] }, chartType: nullableString, chartTypes: strings,
  plotGroups: array(object({ type: string, path: chartPath })), series: array(chartSeries),
  externalData: array(object({ path: chartPath, relationshipId: nullableString, autoUpdate: array(nullableString), binding: chartBinding })),
  workbookParts: strings, resources: array(chartBinding), graphParts: array(part), issues: array(chartIssue) });
const chartRecord = object({ kind: { const: "charts" }, location: resourcePartLocation, name: string, properties: empty,
  references: array(reference), support: { enum: ["read", "preserve"] }, details: chartDetails });
export const chartOperationContracts: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = {
  "charts.list": {
    description: "Read package-wide physical chart definitions once in canonical part order, including unreferenced and opaque parts. Report inert workbook/style/color bindings, grouped sources and indexed cached values with unknown freshness. No selected drawing visibility, formula evaluation, rendering or external refresh. Direct utility inventory is supported; utility batch execution and live chart/workbook models remain unsupported.",
    featureIds: ["F37"], result: { oneOf: [
      object({ version: { const: 1 }, operation: { const: "charts.list" }, ok: { const: true }, data: object({ items: array(chartRecord) }),
        warnings: array(diagnostic), errors: empty, affected: { const: 0 }, locations: array(resourcePartLocation) }),
      object({ version: { const: 1 }, operation: { const: "charts.list" }, ok: { const: false }, data: { type: "null" },
        warnings: empty, errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: empty })
    ] }
  }
};
export const rasterInsertionOperationContracts: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = {
  "images.add": {
    description: "Insert admitted PNG/JPEG or static safe SVG with an explicit validated PNG/JPEG/GIF/BMP/TIFF fallback inline into one paragraph or a new trailing container paragraph; no rasterization or rendering is performed.",
    featureIds: ["F06", "F08", "F11", "F12", "F31", "F32", "F35"],
    result: { oneOf: [object({ version: { const: 1 }, operation: { const: "images.add" }, ok: { const: true },
      data: object({ ...mutationData.properties, changes: { ...array(object({ kind: { const: "add" }, before: location, after: location })), minItems: 0, maxItems: 1 } }),
      warnings: array(diagnostic), errors: empty, affected: { enum: [0, 1] }, locations: { ...array(location), minItems: 0, maxItems: 1 } }),
      object({ version: { const: 1 }, operation: { const: "images.add" }, ok: { const: false }, data: { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: empty })] }
  }
};
export const imageOperationContracts = Object.fromEntries([
  ["images.list", "Inventory selected drawing occurrences and exact owner-local references, separate from shared media. Unique groups only selected owners by byte hash; first selected occurrence supplies representative geometry. Missing or opaque metadata reads null; external links remain inert. No render, pixel decoding or native-size parity.", object({ items: array(imageRecord) })],
  ["images.get", "Inspect one selected drawing occurrence with nullable stored metadata, relationships and exact admitted media identity. Shared bytes do not conflate occurrence-local layout. No rendering, linked acquisition or live image model is implied.", object({ item: imageRecord })],
  ["images.extract", "Extract exact original admitted image bytes and deterministic manifest.json through explicit output-dir VFS authority. Opaque bytes use .bin, never document names. External or unresolved resources skip with warnings and complete false. Manifest counts as an output: one image has two outputs and requires allow-partial-output on the current nontransactional VFS. Preflight all destinations; report actual publication without rollback promises.", imageExtractionData]
].map(([id, description, data]) => [id, { description, featureIds: id === "images.list" ? ["F31", "F34", "F35"] : id === "images.get" ? ["F31", "F33"] : ["F31", "F34"], result: { oneOf: [object({ version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema, warnings: array(diagnostic), errors: empty, affected: { const: 0 }, locations: array(location) }), object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: id === "images.extract" ? { oneOf: [{ type: "null" }, object({ ...imageExtractionData.properties, complete: { const: false } })] } : { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: id === "images.extract" ? array(location) : empty })] } }])) as Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>>;
export const propertyOperationContracts = Object.fromEntries([
  ["properties.list", "Inventory declared core, extended and custom metadata without creating missing parts. Qualified core:/extended:/custom: names identify exact stored keys; opaque and invalid values remain preserve-only without a content dump. Cached counts are stored metadata, never recalculated.", object({ items: array(propertyRecord) })],
  ["properties.get", "Read one exact core:/extended:/custom: property name, or an unqualified name when admitted stored names are unambiguous. Missing names and ambiguous ownership reject. UTC utility dates are whole-second strings; cached values remain read-only and opaque data has no guessed scalar type.", object({ item: propertyRecord })],
  ["properties.set", "Set one exact core:/extended:/custom: property name. New custom names require --type string|boolean|integer|number|date; existing declarations determine the type. Empty string, false and zero are values; null rejects. Utility dates require explicit UTC instant strings and drop fractional seconds. Core text is bounded to 255 Unicode scalars; revision is positive safe integer. Cached, opaque, invalid or ambiguous properties reject. Preserve unrelated timestamps, cached counts, custom variants and IDs; no live model API is implied.", propertyMutationData],
  ["properties.remove", "Remove only one exact supported core:/extended:/custom: property name. Cached, opaque, invalid and ambiguous metadata rejects. Retain the empty part and its relationship; missing selection rejects unless --allow-empty explicitly requests an unchanged result. Preserve unrelated timestamps, counts and custom IDs.", propertyMutationData]
].map(([id, description, data]) => [id, { description, result: { oneOf: [object({ version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema, warnings: array(diagnostic), errors: empty, affected: id === "properties.list" || id === "properties.get" ? { const: 0 } : number, locations: array(resourcePartLocation) }), object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: empty })] } }])) as Readonly<Record<string, { description: string; result: DocxJsonSchema }>>;
const runFormatData = object({ ...mutationData.properties, changes: array(object({ kind: { const: "format" }, before: location, after: location })) });
const contentRemovalData = object({ ...mutationData.properties, changes: array(object({ kind: { const: "remove" }, before: location, after: { oneOf: [location, { type: "null" }] } })) });
const paragraphEditData = object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["format", "replace", "insert"] }, before: location, after: location })) });
const tableEditData = object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["format", "replace", "insert", "delete"] }, before: location, after: location })) });
const tableDetails = object({ kind: { const: "tables" }, rows: number, columns: number,
  cells: array(object({ row: number, column: number, rowSpan: number, columnSpan: number, location, text: string })),
  omitted: array(object({ row: number, before: number, after: number })) });
const tableReadData = object({ item: object({ kind: { const: "tables" }, location, properties: empty, references: empty, support: { const: "read" }, details: tableDetails }) });
const revisionInfo = object({ id: nullableString, author: nullableString, timestamp: nullableString, markup: string, namespace: string, name: nullableString,
  type: { enum: ["insert", "delete", "format", "move", "table", "section", "unsupported"] }, support: { enum: ["supported", "opaque"] } });
const textFormatting = object({ bold: nullableBoolean, italic: nullableBoolean, rtl: nullableBoolean, hidden: nullableBoolean, style: nullableString,
  language: { type: "object", additionalProperties: true }, fonts: { type: "object", additionalProperties: true },
  paragraph: object({ style: nullableString, bidi: nullableBoolean }) });
const textData = object({ revisions: array(revisionInfo), warnings: array(diagnostic), text: string, view: { enum: ["final", "original", "all"] }, hiddenText: { const: "include" },
  segments: array(object({ text: string, location, revisions: array(revisionInfo), revision: { enum: ["insert", "delete", "unchanged"] },
    kind: { enum: ["text", "tab", "line-break", "page-break", "column-break", "paragraph", "cell", "row", "story"] },
    formatting: textFormatting, originalFormatting: { anyOf: [textFormatting, { type: "null" }] } })) });
const sectionBinding = object({ linkedToPrevious: boolean, sourceSection: { oneOf: [number, { type: "null" }] }, part: nullableString });
const sectionBindings = object({ default: sectionBinding, first: sectionBinding, even: sectionBinding });
const sectionDirect = object({ ...Object.fromEntries(["pageWidth", "pageHeight", "topMargin", "bottomMargin", "leftMargin", "rightMargin", "gutter", "headerDistance", "footerDistance", "columns", "columnGap", "pageNumberStart"].map(name => [name, { oneOf: [{ type: "integer" }, { type: "null" }] }])), orientation: string, startType: string, pageNumberFormat: string, differentFirstPage: boolean, columnSeparator: boolean, equalWidth: boolean });
const sectionListData = object({ items: array(object({ position: number, owner: { enum: ["paragraph", "body"] }, location, direct: sectionDirect, headers: sectionBindings, footers: sectionBindings })), units: { const: "twip" }, evenAndOddHeaders: boolean });
const storyReadData = object({ items: array(object({ kind: { enum: ["headers", "footers"] }, section: number, variant: { enum: ["default", "first", "even"] }, part: nullableString, linked: boolean, sourceSection: { oneOf: [number, { type: "null" }] }, owners: array(number), text: string, location })) });
const storyEditData = object({ ...mutationData.properties, affectedSections: array(number), changes: array(object({ kind: { enum: ["replace", "remove", "bind"] }, before: location, after: location })) });
const noteKind: DocxJsonSchema = { enum: ["footnote", "endnote"] };
const noteNumbering = object({ format: string, start: { type: "integer" }, restart: string });
const noteNumberingKinds = object({ footnote: noteNumbering, endnote: noteNumbering });
const noteReadData = object({
  items: array(object({ kind: noteKind, id: { type: "integer", minimum: 0 }, type: string, text: string, location, references: array(location) })),
  separators: array(object({ kind: noteKind, id: { type: "integer", minimum: -1 }, type: string })),
  numbering: object({ document: noteNumberingKinds, sections: array(object({ section: number, ...noteNumberingKinds.properties })) })
});
const noteEditData = object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["insert", "replace", "remove"] }, before: location, after: { oneOf: [location, { type: "null" }] } })) });
const commentAnchor = object({ part: string, path: array(number) });
const commentReadData = object({ items: array(object({ comment_id: number, author: string, initials: nullableString, timestamp: nullableString, text: string, location,
  range: { oneOf: [object({ start: commentAnchor, end: commentAnchor, reference: commentAnchor }), { type: "null" }] }, issues: strings })), issues: strings, modern: { enum: ["preserve", null] } });
const styleMutationData = object({ ...mutationData.properties, changes: array(object({ kind: { const: "style" }, id: string })) });
const styleNumber: DocxJsonSchema = { oneOf: [{ type: "number" }, { type: "null" }] };
const styleProperties = object({
  ...Object.fromEntries(Object.keys(styleFontFlags).map(key => [key, nullableBoolean])),
  ...Object.fromEntries(["themeColor", "underline", "highlight", "baseline", "language", "lineSpacingRule", "alignment"].map(key => [key, nullableString])),
  ...Object.fromEntries(["leftIndent", "rightIndent", "firstLineIndent", "lineSpacing"].map(key => [key, styleNumber])),
  ...Object.fromEntries(["keepTogether", "widowControl", "pageBreakBefore"].map(key => [key, nullableBoolean])),
  tabStops: { oneOf: [array(object({ position: styleNumber, alignment: string, leader: string })), { type: "null" }] },
  bold: nullableBoolean, italic: nullableBoolean, font: nullableString, size: styleNumber, color: nullableString,
  outlineLevel: styleNumber, keepWithNext: nullableBoolean, spaceBefore: styleNumber, spaceAfter: styleNumber,
  numbering: { oneOf: [object({ id: nullableString, level: styleNumber }), { type: "null" }] } });
const styleInspectionData = object({
  styles: array(object({ id: string, name: string, type: string, builtin: boolean, base: nullableString, next: nullableString,
    linkedStyle: nullableString, defaultForType: boolean, priority: styleNumber, hidden: boolean, locked: boolean, quickStyle: boolean,
    unhideWhenUsed: boolean, direct: styleProperties, effective: { oneOf: [styleProperties, { type: "null" }] },
    runXml: nullableString, paragraphXml: nullableString, tableXml: nullableString })),
  defaults: object({ run: styleProperties, paragraph: styleProperties }), latentXml: nullableString,
  latent: { oneOf: [object({ defaults: object({ defaultToHidden: boolean, defaultToLocked: boolean, defaultToQuickStyle: boolean, defaultToUnhideWhenUsed: boolean, defaultPriority: styleNumber, loadCount: styleNumber }), entries: array(object({ name: string, hidden: nullableBoolean, locked: nullableBoolean, quickStyle: nullableBoolean, unhideWhenUsed: nullableBoolean, priority: styleNumber })) }), { type: "null" }] },
  diagnostics: array(object({ code: string, part: string, location: string, message: string }))
});
const signatureRelationship = object({ owner: string, id: string, type: string, target: nullableString, external: boolean });
const signatureListData = object({ verified: { type: "null" }, relationships: array(signatureRelationship), items: array(object({ kind: { const: "signatures" }, name: string, location, properties: empty, references: empty, support: { const: "read" }, details: object({ kind: { const: "signatures" }, role: { enum: ["origin", "signature", "certificate", "relationship-target"] }, verified: { type: "null" } }) })) });
const signatureMutationData = object({ changed: boolean, dryRun: boolean, removedParts: strings, removedRelationships: array(signatureRelationship), removedContentTypes: array(object({ kind: { enum: ["default", "override"] }, name: string, contentType: string })), output: { oneOf: [object({ path: nullableString, bytes: number, sha256: string }), { type: "null" }] } });
const controlPicture = object({ relationshipId: string, target: nullableString, external: boolean, contentType: nullableString });
const controlSnapshot = object({ location, kind: { enum: ["plain-text", "rich-text", "checkbox", "dropdown", "combo-box", "date", "picture", "repeating-section", "repeating-item", "unsupported"] },
  id: nullableString, tag: nullableString, alias: nullableString, lock: string, placeholder: boolean,
  binding: { anyOf: [object({ storeItemId: nullableString, xpath: nullableString, prefixMappings: nullableString }), { type: "null" }] },
  value: { anyOf: [string, boolean, controlPicture, { type: "null" }] }, choices: array(object({ value: string, label: string })),
  support: { enum: ["supported", "unsupported"] }, reason: nullableString });
export const inspectionOperationMetadata: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = Object.fromEntries([
  ...Object.entries(propertyOperationContracts).map(([id, contract]) => [id, { ...contract, featureIds: ["F30"] }]),
  ...[
  ["custom-xml.list", "Inventory internal customXML roots, declared properties, namespace bindings and inert schema references across the package. Preserve ancillary payloads; no content dump, schema fetch or semantic editing. Package-global json/limit only; story selectors and publication flags reject.", ["F41"], customXmlData],
  ["signatures.list", "Inventory signature origin, relationship and part structures without cryptographic verification.", ["F43"], signatureListData],
  ["signatures.remove", "Explicitly remove the complete signature graph and content-type declarations; preserve unrelated bytes or reject unsafe removal before publication.", ["F43"], signatureMutationData],
  ["settings.list", "Read global compatibility, field-update, font embedding and protection metadata without creating settings.", ["F42"], settingsData],
  ["glossary.list", "Inventory glossary roots, stored building-block metadata and internal ancillary resources across the package. Preserve unknown blocks; no content dump, import or execution. Package-global json/limit only; story selectors and publication flags reject.", ["F41"], glossaryData],
  ["controls.list", "Inspect individually indexed scalar and native repeating controls, typed stored values, IDs/tags/aliases, locks, placeholders, bindings, choices and picture relationships. Unsupported and nested controls remain inventoried; no separate get route or live model owner is declared.", ["F28", "F29"], object({ items: array(controlSnapshot) })],
  ["controls.set", "Fill exactly one explicit text/checked/choice/date/file value on a selected control or scoped all. Preserve properties and required owners; clear showingPlcHdr only. Bound, locked, compound and affected nested structures refuse filling atomically. Picture input is bounded owned PNG through explicit VFS authority. Use controls bind for synchronized declared bindings. Live owners and ordered batches remain unsupported.", ["F28"], mutationData],
  ["template.apply", "Fill explicitly tagged body template controls and nested native rows/sections from exact typed records. At most four repeat levels and 1,000 items per region, subject to cumulative node/media/reference budgets; no executable expressions. Empty arrays retain cleared reusable prototypes. Unrelated brace text and stories are preserved. Live model APIs remain pending.", ["F47"], mutationData],
  ["controls.repeat", "Expand one selected native repeating block or complete unmerged row from exact tagged scalar records. Empty data retains one reusable placeholder item. Remap contained control, bookmark, classic-comment and drawing identities and internal image relationships; retained media requires admitted inline RGB/RGBA PNG. Affected locks, bindings, review, opaque structures and crossing annotations reject atomically. Live owners and ordered control batches remain pending.", ["F29"], mutationData],
  ["controls.bind", "Synchronize one exact declared binding tag across the singleton internal custom XML leaf and every same-target recipient, including aliases, within explicit complete scope. Resolve root-inclusive QName child paths from stored namespaces; preserve false, zero and empty values with declared scalar types. Incomplete scope, ambiguous stores, unsupported selectors or recipients and locks reject atomically. Bindings remain attached; live owners and ordered batches remain pending.", ["F29"], mutationData],
  ["revisions.accept", "Accept selected supported text/property revisions atomically; retain current text/properties and report removed review owners. Select a whole revision token, scoped ordinal or explicit scoped all. Unsupported affected review fails before edits; live owners and ordered batches remain unsupported.", ["F26"], mutationData],
  ["revisions.reject", "Reject selected supported text/property revisions atomically; restore admitted original text/properties and report removed review owners. Select a whole revision token, scoped ordinal or explicit scoped all. Unsupported affected review fails before edits; live owners and ordered batches remain unsupported.", ["F26"], mutationData],
  ["revisions.list", "Inspect revision IDs, authors, stored timestamps and supported versus opaque read types; view defaults to all. Read support is distinct from the bounded text/property acceptance and rejection editing subset.", ["F26", "F27"], object({ view: { enum: ["final", "original", "all"] }, items: array(object({ ...revisionInfo.properties, location })) })],
  ["comments.list", "List classic comment bodies separately from visible text, with range consistency diagnostics; no parts are created.", ["F25"], commentReadData],
  ["comments.get", "Read one comment using a whole comment token or one-based --comment ordinal in numeric ID order.", ["F25"], commentReadData],
  ["comments.add", "Anchor a nonempty body paragraph range at existing run boundaries, with explicit author and UTC timestamp. Overlapping comments and field boundaries reject.", ["F25"], noteEditData],
  ["comments.set", "Replace one simple comment body text, preserving author, initials, timestamp and anchors. Rich blocks require scoped editors.", ["F25"], noteEditData],
  ["comments.remove", "Remove selected classic comment bodies and their markers, including deleted-anchor bodies. Preserve unrelated annotations and modern metadata.", ["F25"], noteEditData],
  ["notes.list", "Read both footnotes and endnotes, references, separators and effective numbering without creating parts.", ["F24"], noteReadData],
  ["notes.get", "Read a selected note, its references and preserved numbering; selection defaults to footnotes.", ["F24"], noteReadData],
  ["notes.add", "Insert a footnote or endnote reference with a scoped allocated ID and required separators.", ["F24"], noteEditData],
  ["notes.set", "Replace selected note text with explicit shared-body intent; preserve required note markers.", ["F24"], noteEditData],
  ["notes.remove", "Remove selected references and only unreferenced note bodies; preserve required separators.", ["F24"], noteEditData],
  ["bookmarks.list", "Inspect bookmark ranges, checked names/IDs and structural issues.", ["F21"], object({ items: array(object({ location, name: string, id: string, end: { anyOf: [object({ part: string, path: array({ type: "integer", minimum: 0 }) }), { type: "null" }] }, issues: array(string) })), issues: array(string) })],
  ...["bookmarks.add", "bookmarks.set", "bookmarks.remove"].map(id => [id, id === "bookmarks.add" ? "Create a checked bookmark around a selected paragraph range." : id === "bookmarks.set" ? "Rename a bookmark with explicit reference-update policy." : "Remove a bookmark with explicit reference-removal policy.", ["F21"], object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["insert", "rename", "remove"] }, before: location, after: location })) })]),
  ["fields.list", "List simple/complex/nested fields with exact instructions, cached values and locations.", ["F22"], object({ items: array(object({ location, form: { enum: ["simple", "complex"] }, kind: string, instruction: string, result: string, update: boolean, locked: boolean, nested: array(location) })) })],
  ["fields.set", "Set cached field results or update flags without instruction execution.", ["F22"], mutationData],
  ...["fields.add", "toc.add", "toc.set", "captions.add", "captions.set"].map(id => [id, "Create or edit bounded inert fields and static labels; cached values are never recalculated.", id.startsWith("fields.") ? ["F22"] : ["F23"], object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["insert", "replace"] }, before: location, after: location })) })]),
  ["links.list", "List inert links with stored address, separate anchor, label and owner location.", ["F21"], object({ items: array(object({ location, text: string, address: string, fragment: string, url: string, history: boolean, contains_page_break: boolean })) })],
  ...["links.add", "links.set", "links.remove"].map(id => [id, id === "links.add" ? "Append a hyperlink label to a selected paragraph." : id === "links.set" ? "Change the target while preserving label runs and owner relationships." : "Remove a hyperlink: unwrap its visible label by default; --delete-content deletes it.", ["F21"], object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["insert", "target", "unwrap", "remove"] }, before: location, after: location })) })]),
  ["tables.get", "Inspect one table's 1-based logical cell anchors, spans, omitted slots and exact text.", ["F19", "F20"], tableReadData],
  ["tables.merge", "Merge a complete rectangle with an explicit content join policy.", ["F20"], tableEditData],
  ["tables.split", "Restore a merged cell's existing grid slots with explicit content distribution.", ["F20"], tableEditData],
  ["tables.set", "Replace selected cell values or edit table, row and cell formatting without growing the grid.", ["F19"], tableEditData],
  ["tables.rows.add", "Insert a row before a 1-based index, or append at count+1.", ["F19"], tableEditData],
  ["tables.rows.remove", "Delete an explicit 1-based row while preserving surviving cells and properties.", ["F19"], tableEditData],
  ["tables.columns.add", "Insert a column before a 1-based index, or append at count+1.", ["F19"], tableEditData],
  ["tables.columns.remove", "Delete an explicit 1-based column while preserving surviving cells and properties.", ["F19"], tableEditData],
  ["tables.add", "Create a bounded rectangular table with typed nested blocks, explicit grid widths and table/row/cell formatting; preserve surrounding sections.", ["F19"], paragraphEditData],
  ["lists.add", "Insert a list item with bounded nesting and an optional starting value.", ["F18"], paragraphEditData],
  ["lists.set", "Change list nesting or restart selected items while preserving other lists.", ["F18"], paragraphEditData],
  ["headers.list", "Inspect default/first/even story bindings and cached text without creating absent definitions.", ["F16", "F17"], storyReadData],
  ["headers.get", "Inspect default/first/even story bindings and cached text without creating absent definitions.", ["F16", "F17"], storyReadData],
  ["headers.set", "Use --shared to edit all owners, or --link-to-previous false to clone one section locally.", ["F16", "F17"], storyEditData],
  ["headers.remove", "Remove a local binding, including in the first section. Preserve later stories and referenced resources.", ["F16", "F17"], storyEditData],
  ["footers.list", "Inspect default/first/even story bindings and cached text without creating absent definitions.", ["F16", "F17"], storyReadData],
  ["footers.get", "Inspect default/first/even story bindings and cached text without creating absent definitions.", ["F16", "F17"], storyReadData],
  ["footers.set", "Use --shared to edit all owners, or --link-to-previous false to clone one section locally.", ["F16", "F17"], storyEditData],
  ["footers.remove", "Remove a local binding, including in the first section. Preserve later stories and referenced resources.", ["F16", "F17"], storyEditData],
  ["styles.latent.list", "Inspect latent style entries and defaults without creating definitions.", ["F14"], styleInspectionData],
  ["styles.latent.get", "Inspect latent style entries and defaults without creating definitions.", ["F14"], styleInspectionData],
  ["styles.latent.add", "Edit latent style entries or defaults with explicit inheritance resets.", ["F14"], styleMutationData],
  ["styles.latent.set", "Edit latent style entries or defaults with explicit inheritance resets.", ["F14"], styleMutationData],
  ["styles.latent.remove", "Edit latent style entries or defaults with explicit inheritance resets.", ["F14"], styleMutationData],
  ["styles.latent.defaults.get", "Inspect latent style entries and defaults without creating definitions.", ["F14"], styleInspectionData],
  ["styles.latent.defaults.set", "Edit latent style entries or defaults with explicit inheritance resets.", ["F14"], styleMutationData],
  ["styles.list", "Inspect style definitions, inherited properties, document defaults and relationship diagnostics.", ["F14"], styleInspectionData],
  ["styles.get", "Inspect one style by exact name without creating missing definitions.", ["F14"], styleInspectionData],
  ["styles.defaults.get", "Inspect document run and paragraph defaults without mutation.", ["F14"], styleInspectionData],
  ["styles.add", "Create a paragraph, character or table style with a collision-free ID; matching names are never overwritten.", ["F14"], styleMutationData],
  ["styles.set", "Edit selected style properties and relationships; null removes direct formatting and omissions preserve metadata.", ["F14"], styleMutationData],
  ["styles.defaults.set", "Edit document run and paragraph defaults; null removes direct values and omissions preserve metadata.", ["F14"], styleMutationData],
  ["sections.list", "List section owners, stored twip geometry and explicit or inherited header/footer bindings without creating parts. Missing geometry stays null; no pagination is inferred.", ["F16"], sectionListData],
  ["sections.set", "Edit selected section geometry, columns, start and page-number metadata. Orientation never swaps dimensions. Different-first-page is local; even-and-odd-headers requires --all because it is document-wide. Header/footer content and bindings use the headers and footers commands.", ["F02", "F04", "F16"], paragraphEditData],
  ["sections.add", "Append a section with inherited geometry and header/footer bindings. Start type defaults NEW_PAGE. Preserve paragraph-owned breaks and final body properties.", ["F02", "F04", "F16"], paragraphEditData],
  ["paragraphs.remove", "Remove an explicitly selected whole paragraph or half-open Unicode scalar range.", ["F44"], contentRemovalData],
  ["runs.remove", "Remove an explicitly selected whole run or run/paragraph scalar range.", ["F44"], contentRemovalData],
  ["tables.remove", "Remove an explicitly selected whole table and retain surrounding content.", ["F44"], contentRemovalData],
  ["paragraphs.set", "Set direct paragraph properties; null resets inheritance. Text replaces run content and formatting while retaining paragraph properties and annotation boundaries. Tabs, borders and shading accept --tab-stops-json, --borders-json and --shading-json. Model batches remain pending.", ["F02", "F04", "F13"], paragraphEditData],
  ["paragraphs.add", "Append a block to a story or cell; a paragraph anchor inserts after, or --before. A collapsed paragraph range splits at its Unicode scalar caret and retains the suffix and section properties. Level 0 creates Title; levels 1-9 create headings while preserving conflicting user style definitions. An explicit style and level cannot be combined.", ["F02", "F04", "F13", "F15"], paragraphEditData],
  ["runs.add", "Append text and an optional --break line|page|column inside a paragraph. A collapsed paragraph range inserts inline without dropping suffix text or formatting.", ["F02", "F04", "F13"], paragraphEditData],
  ["runs.set", "Format selected runs or a fingerprinted run/paragraph scalar range. Omission leaves direct properties unchanged; null removes them. Explicit false/default overrides inheritance. Preserve complex-script and CJK properties. Whole-text assignment and model batches remain pending.", ["F02", "F04", "F09", "F12"], runFormatData],
  ["revisions.add", "Create bounded tracked insertion or deletion with explicit author and UTC timestamp; insert at a scalar caret or append to selected text, delete a nonempty scalar range or whole text. Preserve original/final views and direct formatting; existing affected review and compound boundaries reject. Acceptance/rejection is a separate bounded subset; live owners and ordered batches remain unsupported.", ["F26"], mutationData],
  ["sanitize", "Apply explicit category actions to staged bytes; report exact effects and retained gaps", ["F46"], object({ changed: boolean, actions: array(object({ category: { enum: ["properties", "comments", "revisions", "links", "objects"] }, action: { enum: ["remove-supported-properties", "remove-supported-comments-and-markers", "accept-supported-revisions", "reject-supported-revisions", "unwrap-external-hyperlinks-preserving-labels", "remove-supported-inert-object-carriers"] }, affected: number, records: array(string) })), retained: array({ enum: ["properties", "comments", "revisions", "links", "objects"] }), gaps: array(string), removedParts: array(string), removedRelationships: array(object({ owner: string, id: string })), dryRun: boolean, output: mutationData.properties!.output! })],
  ["lorem.set", "Replace explicitly selected logical visible text with required seeded dummy words; not anonymization. Preserve run properties, field instructions, relationships and nontext data. Zero computed words is unchanged; generic utility batches and live text owners remain pending.", ["F45"], mutationData],
  ["text.replace", "Replace literal paragraph text across formatting runs; exactly one of --first, --all or --occurrence is required. Field, object, revision and container boundaries stop matches. Inherit the first matched run; --bold/--italic explicitly override those properties. --track-changes requires explicit author and UTC timestamp, retaining deleted text and inserting replacement text; ordinary replacement rejects review metadata.", ["F02", "F04", "F05", "F10", "F26"], mutationData],
  ["create", "Create an original DOCX/DOTX or append typed blocks to an admitted template; explicit dialect and content settings.", ["F01", "F02", "F03", "F11", "F15"], mutationData],
  ["inspect", "Inventory package parts, metadata, theme schemes, font-table entries, embedding metadata and unresolved references without rendering or linked-resource access. Font availability and licensing are unknown; embedded font mutation is unsupported.", ["F06", "F14", "F42", "F41"], inspectionData],
  ["diff", "Compare admitted package payloads, semantic XML, final logical text or stored story structure with explicit scope and shared cumulative limits. ZIP serialization metadata is ignored; XML whitespace, order, values and identifiers are retained. Differences are bounded part-level records, never rendered layout claims.", ["F48"], object({ equal: boolean, mode: { enum: ["parts", "xml", "text", "structure"] }, differences: array(object({ kind: { enum: ["add", "remove", "change"] }, left: { oneOf: [location, { type: "null" }] }, right: { oneOf: [location, { type: "null" }] }, part: string })) })],
  ["validate", "Validate document bytes against the partial core-v1 profile without repairs.", ["F49"], validationData],
  ["text.get", "Extract logical story text with locations, direct formatting and revision views.", ["F08", "F09", "F26"], textData],
  ["xml.get", "Read one absolute XML part as raw bytes or bounded display serialization.", ["F04", "F07"], xmlData],
  ["xml.set", "Replace one complete XML part with validated bytes; preserve opaque content and unrelated parts.", ["F04", "F07"], mutationData]
].map(([id, description, featureIds, data]) => [id, { description, featureIds, result: { oneOf: [object({
  version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema,
  warnings: array(diagnostic), errors: empty, affected: ["template.apply", "sanitize", "paragraphs.remove", "runs.remove", "tables.remove", "signatures.remove", "controls.set", "controls.repeat", "controls.bind", "revisions.accept", "revisions.reject", "revisions.add", "notes.add", "notes.set", "notes.remove", "tables.merge", "tables.split", "tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.add", "lists.add", "lists.set", "headers.set", "headers.remove", "footers.set", "footers.remove", "sections.set", "sections.add", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.set", "styles.add", "styles.set", "styles.defaults.set", "text.replace", "lorem.set", "runs.set", "paragraphs.set", "paragraphs.add", "runs.add"].includes(id as string) ? number : id === "create" ? { const: 1 } : id === "xml.set" ? { type: "integer", minimum: 0, maximum: 1 } : { const: 0 }, locations: array(location)
}), object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: ["xml.set", "paragraphs.set"].includes(id as string) ? locatedDiagnostic : { type: "object" } }, affected: { const: 0 }, locations: ["xml.set", "paragraphs.set"].includes(id as string) ? array(location) : empty })] } }])]) as Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>>;

const objectLocation = object({ kind: { const: "part" }, token: string, value: object({ version: { const: 1 }, sourceSha256: string, generation: { const: 0 }, part: string, story: string, path: array(number), range: { type: "null" } }), positions: object({}) });
const objectResource = object({ part: string, contentType: string, bytes: number, sha256: string });
const objectStatus: DocxJsonSchema = { enum: ["internal", "external", "missing-id", "missing-relationship", "wrong-relationship-type", "ambiguous"] };
const objectDetails = object({ kind: { const: "objects" }, role: { enum: ["ole", "package", "unknown"] }, status: objectStatus,
  resource: { oneOf: [objectResource, { type: "null" }] }, previews: array(object({ relationshipId: nullableString, status: objectStatus, resource: { oneOf: [objectResource, { type: "null" }] } })),
  owners: array(objectLocation), graphParts: array(objectResource), security: object({ macro: { enum: ["declared", "unknown"] }, protected: { const: "unknown" }, content: { const: "opaque" } }) });
const objectRecord: DocxJsonSchema = { ...object({ kind: { const: "objects" }, location: objectLocation, name: string, properties: empty, references: array(reference), support: { const: "preserve" }, details: objectDetails }), required: ["kind", "location", "properties", "references", "support", "details"] };
export const objectOperationContracts = Object.fromEntries([
  ["objects.list", "Inventory inert OLE carriers, shape-bound preview images, shared owners and package relationships including embedded workbooks. Without selectors inventory is package-global; explicit story/owner selectors narrow physical occurrences. Embedded content is opaque: macro/protection is unknown unless declared. External targets are redacted and never fetched. No activation, binary decoding or live owner API.", object({ items: array(objectRecord), document: object({ protected: boolean }) })],
  ["objects.extract", "Extract exact inert object payloads as object-N.bin and deterministic manifest.json through explicit output-dir VFS authority. Previews remain preserved package resources. External/unresolved bindings skip with complete false. Manifest counts as an output; multi-file extraction requires transactions or explicit allow-partial-output. Preflight all destinations and output limits; report actual receipts without rollback guarantees.", imageExtractionData]
].map(([id, description, data]) => [id, { description, featureIds: ["F40"], result: { oneOf: [
  object({ version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema, warnings: array(diagnostic), errors: empty, affected: { const: 0 }, locations: array(location) }),
  object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: id === "objects.extract" ? { oneOf: [{ type: "null" }, object({ ...imageExtractionData.properties, complete: { const: false } })] } : { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: diagnostic }, affected: { const: 0 }, locations: id === "objects.extract" ? array(location) : empty })
] } }])) as Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>>;
