import type { FormatDescriptor } from "./descriptor.js";
import { rawCsvConversion } from "../operations/csv-input.js";
export const csv: FormatDescriptor = { name: "csv", extensions: ["csv"], convert: rawCsvConversion };
