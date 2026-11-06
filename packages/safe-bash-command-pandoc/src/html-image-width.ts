import {PandocError} from "./errors.js";

export function htmlImageWidth(source: string | undefined, dimension: "width" | "height" = "width"): [string, string] {
  let number = "", unit = "", decimal = false;
  for (const char of source ?? "") {
    if (!unit && char >= "0" && char <= "9") number += char;
    else if (!unit && char === "." && !decimal) {number += char; decimal = true;}
    else unit += char;
  }
  const value = Number(number);
  if (!number || !Number.isFinite(value) || value < 0 || !["", "px", "%", "in", "cm", "mm", "pt", "pc", "em"].includes(unit))
    throw new PandocError("E_CAPABILITY", "write", "Unsupported HTML image width", "html5");
  if (!unit || unit === "px") return [dimension, String(Math.round(value))];
  return ["style", `${dimension}:${Number.isInteger(value) ? value.toFixed(1) : value}${unit}`];
}
