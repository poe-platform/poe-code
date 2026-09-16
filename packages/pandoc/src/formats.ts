export interface FormatCapability {
  readonly name: string;
  readonly read: { readonly allowed: boolean; readonly available: boolean };
  readonly write: { readonly allowed: boolean; readonly available: boolean };
}
const directions: readonly [string, boolean, boolean][] = [
  ["commonmark", true, true], ["gfm", true, true], ["html", true, true],
  ["html5", false, true], ["json", true, true], ["csv", true, false],
  ["tsv", true, false], ["plain", false, true], ["latex", true, true],
  ["rst", true, true], ["rtf", true, true], ["epub", true, true],
  ["pdf", false, true], ["docx", true, true], ["pptx", true, true], ["xlsx", true, false]
];
/** Built-in availability only; supplied capabilities do not change this stable descriptor. */
export const formatCapabilities: readonly FormatCapability[] = Object.freeze(directions.map(([name, read, write]) => Object.freeze({
  name, read: Object.freeze({ allowed: read, available: false }), write: Object.freeze({ allowed: write, available: false })
})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
