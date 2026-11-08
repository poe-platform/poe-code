import {loadCLIReference} from "./cli-reference.mjs";
import {hasOwnErrorCode} from "../../toolcraft/dist/error-codes.js";
export function loadPresetReference(readFile){return loadCLIReference([
  "loadPresetValues","validatePresetFieldValue","validatePresetScalarValue",
  "describeExpectedPresetValue","hasNestedField","isPlainObject","toDisplayPath",
  "describeReceived","matchesStringPattern","unwrapOptional",
  "formatJsonParseUserErrorMessage","getJsonParseErrorLocation","getErrorMessage",
  "getSourceOffsetLocation","getJsonParseCauseLocation","getNumericProperty",
  "getJsonParseMessagePosition","isAsciiDigit","removeNativeJsonParseLocation","hasOwnProperty"
],[],{readFile,hasOwnErrorCode});}
