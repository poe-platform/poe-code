import type { FormatDescriptor } from "./descriptor.js";
import { geojsonConversion } from "../operations/geojson-input.js";
export const geojson: FormatDescriptor = { name: "geojson", convert: geojsonConversion };
