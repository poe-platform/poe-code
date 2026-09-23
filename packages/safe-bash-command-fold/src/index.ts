export { parseFoldArguments } from './arguments.js';
export { createFoldEngine, type FoldEngine, type FoldAccounting } from './engine.js';
export { FoldError, type FoldErrorCode, type FoldLimits, type FoldMode, type FoldOptions } from './contracts.js';
export { portableWidth } from './width.js';
export { adjustFoldColumn, type FoldLocale, type FoldColumnState, type FoldGlyph } from './column.js';
export { fold, createFoldCommand, foldCommand, foldCommands, type FoldCommandOptions, type FoldRunOptions, type FoldResult } from './command.js';
export { decodeFoldUnit, type FoldUnit } from "./units.js";
