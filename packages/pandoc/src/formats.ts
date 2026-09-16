import type { Limits } from "./types.js";

export interface FormatCapability {
  readonly name: string;
  readonly inputEncoding: "utf8" | "bytes";
  readonly inputBudget?: keyof Limits;
  readonly read: { readonly allowed: boolean; readonly available: boolean };
  readonly write: { readonly allowed: boolean; readonly available: boolean };
}
const directions: readonly [string, boolean, boolean, ("utf8" | "bytes")?, (keyof Limits)?][] = [
  ["commonmark", true, true],
  ["gfm", true, true],
  ["html", true, true],
  ["html5", false, true],
  ["json", true, true],
  ["csv", true, false],
  ["tsv", true, false],
  ["plain", false, true],
  ["latex", true, true],
  ["rst", true, true],
  ["rtf", true, true, "bytes"],
  ["epub", true, true, "bytes", "compressedBytes"],
  ["pdf", false, true, "bytes"],
  ["docx", true, true, "bytes"],
  ["pptx", true, true, "bytes"],
  ["xlsx", true, false, "bytes"]
];
/** Built-in availability only; supplied capabilities do not change this stable descriptor. */
export const formatCapabilities: readonly FormatCapability[] = Object.freeze(
  directions
    .map(([name, read, write, inputEncoding = "utf8", inputBudget]) =>
      Object.freeze({
        name,
        inputEncoding,
        ...(inputBudget === undefined ? {} : { inputBudget }),
        read: Object.freeze({ allowed: read, available: false }),
        write: Object.freeze({ allowed: write, available: false })
      })
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
);
