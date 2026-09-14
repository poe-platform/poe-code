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
  if (all && operation !== "text.replace" && operation !== "lorem.set" &&
    !["set", "remove", "accept", "reject"].includes(action)) reject("All is not applicable to this operation.");

  if (["headers", "footers"].includes(resource) && ["get", "set"].includes(action) && !has("section") && !token)
    reject("Header and footer access requires a section.");
  if (target && ["get", "set", "remove", "replace", "accept", "reject", "repeat", "bind", "merge", "split"].includes(action) &&
    !has(target) && !token && !all) reject("A resource selection is required.");
  if (resource === "tables" && pieces.length === 3 && !has("table") && !token)
    reject("Row and column operations require a table.");
  if (operation === "tables.split" && !has("cell") && !token) reject("Table split requires a cell.");
  if (action === "add" && ["runs", "links", "fields", "notes", "images", "equations"].includes(resource) && !has("paragraph") && !token)
    reject("Inline insertion requires a paragraph.");
  if (operation === "equations.replace" && !token) reject("Equation replacement requires a location token.");
  if (["bookmarks.add", "comments.add", "revisions.add"].includes(operation)) {
    if (!token) reject("Range insertion requires a location token.");
    let range;
    try { range = decodeLocation(options.select as string).range; }
    catch { reject("Invalid range selection token."); }
    if (!range || range.start === range.end && !(operation === "revisions.add" && options.kind === "insert"))
      reject("A nonempty text range is required.");
  }
}
