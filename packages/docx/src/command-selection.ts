import { DocxUsageError } from "./argument-json.js";
import { decodeLocation } from "./location-token.js";

const resourceSelectors: Readonly<Record<string, string>> = {
  paragraphs: "paragraph", runs: "run", tables: "table", sections: "section",
  headers: "section", footers: "section", lists: "paragraph", links: "link",
  bookmarks: "bookmark", fields: "field", toc: "field", captions: "field",
  notes: "note", comments: "comment", revisions: "revision", controls: "control",
  images: "image", shapes: "shape", lorem: "paragraph"
};
const ordinalSelectors = ["section", "table", "cell", "paragraph", "run", "image", "link", "control", "revision", "shape", "field", "bookmark", "note", "comment"];

export function validateDocxSelection(operation: string, options: Readonly<Record<string, unknown>>): void {
  if (operation.startsWith("model.")) return;
  const has = (name: string) => options[name] !== undefined;
  const reject = (message: string): never => { throw new DocxUsageError(message); };
  if (operation === "diff" && ((options.mode === undefined || ["parts", "xml"].includes(options.mode as string)) !== (options.scope === "package"))) reject("Package comparison modes require package scope; logical modes require a story scope.");
  const pieces = operation.split(".");
  const resource = pieces[0]!;
  const action = pieces.at(-1)!;
  const target = resourceSelectors[resource];
  const token = has("select");
  const all = options.all === true;
  const selected = ordinalSelectors.filter(has);

  if ((has("comment") || has("note")) && has("section")) reject("Annotation stories cannot be selected through a section.");
  if (has("table") && (has("paragraph") || has("run")) && !has("cell")) reject("Paragraph selection inside a table requires a cell.");
  if (["sections", "headers", "footers"].includes(resource) &&
    selected.some(key => key !== "section")) reject("Section resources reject descendant selectors.");
  if (resource === "sections" && has("scope")) reject("Sections are package-global resources.");
  if (["styles", "properties", "settings", "fonts", "signatures", "custom-xml", "glossary"].includes(resource) &&
    (selected.length || token || has("scope"))) reject("Global resources reject story selectors.");
  if (all && operation !== "text.replace" && operation !== "lorem.set" && operation !== "revisions.add" && !["controls.repeat", "controls.bind"].includes(operation) &&
    !["set", "remove", "accept", "reject"].includes(action)) reject("All is not applicable to this operation.");

  if (["headers", "footers"].includes(resource) && ["get", "set", "remove"].includes(action) && !has("section") && !token)
    reject("Header and footer access requires a section.");
  if (target && ["get", "set", "remove", "replace", "accept", "reject", "repeat", "bind", "merge", "split"].includes(action) &&
    !has(target) && !token && !all) reject("A resource selection is required.");
  if (resource === "tables" && pieces.length === 3 && !has("table") && !token)
    reject("Row and column operations require a table.");
  if (operation === "tables.split" && !has("cell") && !token) reject("Table split requires a cell.");
  if (action === "add" && ["runs", "links", "fields", "toc", "captions", "notes", "equations"].includes(resource) && !has("paragraph") && !token)
    reject("Inline insertion requires a paragraph.");
  if (operation === "images.add") {
    if (["run", "image", "link", "control", "revision", "shape", "field", "bookmark"].some(has)) reject("Image insertion requires a whole paragraph or block container.");
    if (!token && ["headers", "footers"].includes(options.scope as string) && !has("section")) reject("Image insertion in a header or footer requires an explicit owner.");
    if (!token && ["footnotes", "endnotes"].includes(options.scope as string) && !has("note")) reject("Image insertion in a note requires an explicit owner.");
    if (!token && options.scope === "comments" && !has("comment")) reject("Image insertion in a comment requires an explicit owner.");
  }
  if (operation === "equations.replace" && !token) reject("Equation replacement requires a location token.");
  if (["controls.list", "controls.set", "controls.repeat", "controls.bind"].includes(operation) && token) {
    let range;
    try { range = decodeLocation(options.select as string).range; }
    catch { reject("Invalid control selection token."); }
    if (range !== null) reject("Control operations require whole control or owner tokens.");
  }
  if (["revisions.accept", "revisions.reject"].includes(operation) && token) {
    let range;
    try { range = decodeLocation(options.select as string).range; }
    catch { reject("Invalid revision selection token."); }
    if (range !== null) reject("Revision decisions require a whole revision token.");
  }
  if (operation === "revisions.add") {
    if (!token) {
      if (!has("paragraph") && !has("run") && !all) reject("Tracked creation requires a paragraph or run selection, or explicit all scope.");
    } else {
      let range;
      try { range = decodeLocation(options.select as string).range; }
      catch { reject("Invalid tracked selection token."); }
      if (range && (options.kind === "insert" ? range.start !== range.end : range.start === range.end))
        reject("Tracked insertion requires a caret; deletion requires nonempty text.");
    }
  }
  if (["bookmarks.add", "comments.add"].includes(operation)) {
    if (!token) reject("Range insertion requires a location token.");
    let range;
    try { range = decodeLocation(options.select as string).range; }
    catch { reject("Invalid range selection token."); }
    if (!range || range.start === range.end)
      reject("A nonempty text range is required.");
  }
}
