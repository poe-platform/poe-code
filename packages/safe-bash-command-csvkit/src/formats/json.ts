import type { FormatDescriptor } from "./descriptor.js";
import { jsonConversion } from "../operations/json-input.js";
export const json: FormatDescriptor = { name: "json", extensions: ["json", "js"], inferredBy: "key", convert: runtime => jsonConversion(runtime, false) };
