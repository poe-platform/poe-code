import {createConverter} from "./runtime.js";
import {loadWasm} from "#document-converter-wasm";
export {createConverter} from "./runtime.js";
export type {ConversionRequest, ConversionResult, ConversionControl, Resource, Converter, DrawingRequest, DrawingResult, DiagramTheme, DiagramThemeMode, DiagramThemeTokens, VectorScene, VectorNode, VectorPath, VectorStroke, VectorText, VectorImage, VectorColor} from "./runtime.js";

// Each platform receives the same pinned runtime without a network loader.
export const convert = createConverter(loadWasm);
