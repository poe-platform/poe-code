import { DocxUsageError } from "./argument-json.js";
import { validateDocxValue } from "./operation-schema.js";

const coreStrings = new Set(["title", "subject", "author", "keywords", "comments", "lastModifiedBy", "category", "contentStatus", "identifier", "language", "version"]);
const coreDates = new Set(["created", "modified", "lastPrinted"]);
const extendedStrings = new Set(["company", "manager", "template"]);
const cachedExtended = new Set(["pages", "words", "characters", "charactersWithSpaces", "lines", "paragraphs", "totalTime", "application", "appVersion"]);
const propertyTypes = new Set(["string", "boolean", "integer", "number", "date"]);

export function normalizeDocxPropertyOptions(options: Record<string, unknown>, cli: boolean): Record<string, unknown> {
  const name = options.name;
  if (typeof name !== "string" || !validateDocxValue("identifier", name)) throw new DocxUsageError("A nonempty property name is required.");
  const colon = name.indexOf(":");
  const namespace = colon < 0 ? undefined : name.slice(0, colon);
  const key = colon < 0 ? name : name.slice(colon + 1);
  if (!key || (namespace !== undefined && !["core", "extended", "custom"].includes(namespace))) throw new DocxUsageError("Unknown property namespace or empty property name.");

  let declared: string | undefined;
  let core = false;
  if (namespace === undefined || namespace === "core") {
    if (coreStrings.has(key)) declared = "string";
    else if (coreDates.has(key)) declared = "date";
    else if (key === "revision") declared = "integer";
    core = declared !== undefined;
    if (!declared && namespace === "core") throw new DocxUsageError("This core property is not writable.");
  }
  if (!declared && (namespace === undefined || namespace === "extended")) {
    if (cachedExtended.has(key)) throw new DocxUsageError("Cached extended properties are read-only.");
    if (extendedStrings.has(key)) declared = "string";
    if (!declared && namespace === "extended") throw new DocxUsageError("This extended property is not writable.");
  }
  if (options.type !== undefined && (typeof options.type !== "string" || !propertyTypes.has(options.type))) throw new DocxUsageError("Unknown property type.");
  if (declared && options.type !== undefined && options.type !== declared) throw new DocxUsageError("Property type conflicts with its declaration.");
  const type = declared ?? options.type;

  let value = options.value;
  if (cli) {
    if (typeof value !== "string") throw new DocxUsageError("Expected a literal property value.");
    if (type === "boolean") {
      if (value !== "true" && value !== "false") throw new DocxUsageError("Expected true or false for a boolean property.");
      value = value === "true";
    } else if (type === "integer" || type === "number") {
      if (!value || [...value].some(character => !"0123456789+-.eE".includes(character))) throw new DocxUsageError("Expected finite decimal property notation.");
      value = Number(value);
    }
  }
  // An omitted custom type requires admitted metadata before conversion or creation.
  const valueType = type === "date" ? "UTC instant" : typeof type === "string" ? type : "typed scalar";
  if (!validateDocxValue(valueType, value) ||
      (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value))) throw new DocxUsageError("Property value does not match its declared type.");
  if (core && key === "revision" && (value as number) <= 0) throw new DocxUsageError("Core revision must be a positive safe integer.");
  if (core && type === "string" && [...(value as string)].length > 255) throw new DocxUsageError("Core property text exceeds 255 Unicode scalars.");
  return { ...options, value };
}
