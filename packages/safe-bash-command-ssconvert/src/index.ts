export { createEngine, defaultSsconvertLimits } from "./engine.js";
export type { RuntimeLimits as SsconvertLimits } from "./contracts.js";
export const readXlsx: typeof import("./codecs/xlsx.js")["readXlsx"] = async (...args) => (await import("@poe-code/spreadsheet-format-xlsx/xlsx")).readXlsx(...args);
export const probeXlsx: typeof import("./codecs/xlsx.js")["probeXlsx"] = async (...args) => (await import("@poe-code/spreadsheet-format-xlsx/xlsx")).probeXlsx(...args);
import { snapshotXlsxWorkbook } from "@poe-code/spreadsheet-format-xlsx/xlsx-write-input";
export const createXlsxWriter: typeof import("./codecs/xlsx.js")["createXlsxWriter"] = (edition = "2006") => async (book, options, context) => {
  const ownedBook = snapshotXlsxWorkbook(book, context);
  return (await import("@poe-code/spreadsheet-format-xlsx/xlsx")).createXlsxWriter(edition)(ownedBook, options, context);
};
export { referenceText } from "./cli/reference.js";
export { exportOptionPairs } from "./cli/export-options.js";
export { createResourceIO } from "./io/index.js";
export { resolveVfsCwd } from "./io/cwd.js";
export type { WorkingDirectoryFileSystem } from "./io/cwd.js";
export type { ResourceIOOptions, DescriptorBinding } from "./io/index.js";
export { createVfsOutput } from "./io/publication.js";
export type { PublicationFileSystem } from "./io/publication.js";
export { parseCommand, runCommand } from "./cli.js";
export type { ParsedCommand, CommandOperation, CommandProfile, CommandArgument } from "./cli.js";
export * from "./contracts.js";
export * from "./workbook.js";
// Both facades expose these names; select their shared owner explicitly when
// the engine and AST remain external to the split command bundle.
export { SsconvertError, isSsconvertError } from "@poe-code/spreadsheet-ast/errors";
export { exportRangeForSheet } from "./workbook/expressions.js";
export type * from "./codecs.js";
export { createRegistry, sourceServices } from "./codecs.js";
export { xlsxFormat } from "./formats/xlsx.js";
export { csvFormat } from "./formats/csv.js";
export { odsFormat } from "./formats/ods.js";
export { xlsFormat } from "./formats/xls.js";
export { spreadsheetmlFormat } from "./formats/spreadsheetml.js";
export type * from "./formulas.js";
export { recalculateWorkbook } from "./formulas/recalculation.js";
export { recalculateWorkbook as recalculateWorkbookSync } from "./formulas/evaluator.js";
export * from "./formulas/ast.js";
export * from "./formulas/conventions.js";
export { parseExpression } from "./formulas/parser.js";
export { serializeExpression } from "./formulas/serialization.js";
export { rewriteReferences, visitFormula } from "./formulas/rewriting.js";
export type { ReferenceRewrite } from "./formulas/rewriting.js";
export { renameWorkbookSheet, moveWorkbookSheet, translateFormulaGroup } from "./formulas/workbook.js";
export { resizeWorkbookReferences, parseResize, suggestSheetSize } from "./workbook/resize.js";
export * from "./formatting.js";
export type * from "./rendering.js";
export { createImageRendering, encodeGraphImage, imageFormats, profileImageTargets, ImageExportError } from "./rendering/images/index.js";
export type { ImageRenderingOptions, GraphSceneRequest, ImageSurface, ImageCommand, ImagePathCommand } from "./rendering/images/index.js";
export { createAxisMap } from "./rendering/chart/axis.js";
export type { AxisMap, AxisMapRequest } from "./rendering/chart/axis.js";
export { orientedBounds, rectanglesOverlap, positionLabel } from "./rendering/chart/layout.js";
export type { Rectangle, OrientedRectangle, LabelAnchor } from "./rendering/chart/layout.js";
export { pieWedges } from "./rendering/chart/pie.js";
export type { PieGeometryRequest, PieWedge } from "./rendering/chart/pie.js";
export { markerGeometry } from "./rendering/chart/marker.js";
export type { MarkerGeometry, MarkerShape, MarkerCommand } from "./rendering/chart/marker.js";
export { errorBarBounds, cartesianErrorBarSegments } from "./rendering/chart/error-bar.js";
export type { ErrorBarData, ErrorBarBounds, CartesianErrorBarRequest, ChartSegment } from "./rendering/chart/error-bar.js";
export { cartesianSeriesPath } from "./rendering/chart/line.js";
export type { CartesianInterpolation, CartesianSeriesRequest, SeriesPathCommand } from "./rendering/chart/line.js";
export { paginateAxis } from "./rendering/print/pagination.js";
export type { AxisPrintRequest, AxisPrintPage, PrintBreak } from "./rendering/print/pagination.js";
export { layoutPrintPages } from "./rendering/print/layout.js";
export type { PrintLayoutRequest, PrintLayout, PrintPage } from "./rendering/print/layout.js";
export { renderPrintHeaderFooter } from "./rendering/print/header-footer.js";
export type { PrintHeaderFooterInfo } from "./rendering/print/header-footer.js";
export type * from "./solver.js";
export * from "./objects/index.js";
export * from "./objects/layout.js";

export { loadSolverParameters } from "./solver/model.js";
export type { SolverParameters, SolverConstraint, SolverRelation, SolverAddress, SolverModelType, SolverAlgorithm } from "./solver/model.js";
export { solverAlgorithms, runSolverValidation as runSolver } from "./solver/run.js";

export type { RuntimeFunction, RuntimeFunctions, RuntimeFunctionResult } from "./formulas/runtime-functions.js";
export { perlSampleFunctions, pythonSampleFunctions, createPythonSampleFunctions } from "./formulas/optional-providers.js";
export type { PythonUnicodeVersion } from "./formulas/functions/python-unicode-profile.js";
export { snapshotRuntimeFunctions } from "./formulas/runtime-functions.js";

export type { DatasourceCapability, DatasourceTransport, DatasourceSession } from "./datasource.js";

export { createDatabaseFunctions } from "./formulas/database-functions.js";
export type { DatabaseQuery, DatabaseQueryRequest, DatabaseQueryResult } from "./formulas/database-functions.js";

export * from "./command.js";

export { createSyncSsconvertEvaluator, type SynchronousSpreadsheetArchive } from "./sync.js";
