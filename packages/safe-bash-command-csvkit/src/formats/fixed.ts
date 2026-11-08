import type { FormatDescriptor } from "./descriptor.js";
import { fixedConversion } from "../operations/fixed-input.js";
export const fixed: FormatDescriptor = { name: "fixed", extensions: ["fixed"], inferredBy: "schema", extensionless: true, convert: fixedConversion };
