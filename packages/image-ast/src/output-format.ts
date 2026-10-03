import type {ImageFormat} from "./ast.js";

/** Vector inputs retain the established default raster output. */
export function imageOutputFormat(input:ImageFormat,requested?:ImageFormat):ImageFormat {
 return requested==="svg"?"png":requested??(input==="svg"||input==="pdf"?"png":input);
}
