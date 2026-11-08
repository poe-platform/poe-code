import type { FormatDescriptor } from "./descriptor.js";
import { jsonConversion } from "../operations/json-input.js";
export const ndjson: FormatDescriptor = { name: "ndjson", convert: runtime => jsonConversion(runtime, true) };
