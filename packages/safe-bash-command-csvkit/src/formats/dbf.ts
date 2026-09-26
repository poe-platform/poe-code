import type { FormatDescriptor } from "./descriptor.js";
import { dbfConversion } from "../operations/dbf-input.js";
export const dbf: FormatDescriptor = { name: "dbf", extensions: ["dbf"], convert: dbfConversion };
