import { parseFilterExpression } from "./filter-expression.js";

export function parseTempo(argument: string): number {
  let tempo = 1;
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? (index === 0 ? "tempo" : "") : option.slice(0, separator).trim();
    if (key === "enable") throw new Error("atempo: timeline is unsupported");
    if (key !== "tempo") throw new Error("atempo: unknown option");
    tempo = parseFilterExpression(separator < 0 ? option : option.slice(separator + 1), "atempo", {});
    if (tempo < 0.5 || tempo > 100) {
      throw new RangeError("atempo: must be in the range [0.5, 100]");
    }
  }
  return tempo;
}
