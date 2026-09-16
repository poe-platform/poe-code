import type { DocxJsonSchema } from "./operation-json-schema.js";
import { InputTypeError, InvalidContainerError, ResourceLimitError } from "./archive.js";
import { normalizePartName } from "./part-uri.js";
import type { DocumentBudget } from "./budget.js";

export interface PackageEntry {
  readonly part: string;
  readonly path: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface PackageInventoryV1 {
  readonly version: 1;
  readonly kind: "docx" | "dotx";
  readonly dialect: "strict" | "transitional";
  readonly entries: readonly PackageEntry[];
  readonly selection?: "all";
  readonly pretty?: boolean;
  readonly directories?: readonly string[];
}

/** Unicode scalar ordering, shared by inventory producer and consumer. */
export function compareInventoryNames(left: string, right: string): number {
  const a = [...left], b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = a[i]!.codePointAt(0)! - b[i]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new InputTypeError("Expected an inventory record.");
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !keys.includes(key) || !("value" in descriptor)) throw new InputTypeError("Unknown inventory field or accessor.");
    result[key] = descriptor.value;
  }
  return result;
}
export function inventoryPath(path: unknown, absolute: boolean): asserts path is string {
  if (typeof path !== "string" || !path || path.startsWith("/") !== absolute || path.includes("\\") || path.includes(":"))
    throw new InvalidContainerError("Unsafe inventory VFS path.");
  const segments = (absolute ? path.slice(1) : path).split("/");
  for (const segment of segments) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { throw new InvalidContainerError("Invalid inventory path escape."); }
    if (!segment || segment === "." || segment === ".." || segment.endsWith(".") || segment.endsWith(" ") || decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === ".." || [...decoded].some(c => c.codePointAt(0)! < 32 || c === "\x7f") || [...segment].some(c => c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff))
      throw new InvalidContainerError("Unsafe inventory VFS path.");
  }
}
function sequence(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new InputTypeError("Expected inventory entries.");
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !Object.hasOwn(value, key) || !Number.isSafeInteger(Number(key)) || String(Number(key)) !== key || Number(key) < 0 || Number(key) >= value.length || !("value" in Object.getOwnPropertyDescriptor(value, key)!))
      throw new InputTypeError("Invalid inventory sequence.");
  }
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new InputTypeError("Sparse inventory sequence.");
  return value;
}
export function admitPackageInventory(value: unknown, budget: DocumentBudget, absolute: boolean): PackageInventoryV1 {
  const input = record(value, ["version", "kind", "dialect", "entries", "selection", "pretty", "directories"]);
  if (input.version !== 1 || !["docx", "dotx"].includes(input.kind as string) || !["strict", "transitional"].includes(input.dialect as string) || input.selection !== undefined && input.selection !== "all" || input.pretty !== undefined && typeof input.pretty !== "boolean")
    throw new InputTypeError("Expected a complete version 1 package inventory.");
  const raw = sequence(input.entries);
  budget.check("zipEntries", raw.length);
  if (!raw.length) throw new InputTypeError("Package inventory is empty.");
  const paths = new Set<string>(), parts = new Set<string>();
  let prior: string | undefined, total = 0;
  const entries = raw.map(value => {
    const e = record(value, ["part", "path", "contentType", "bytes", "sha256"]);
    if (typeof e.part !== "string" || !e.part || typeof e.contentType !== "string" || !e.contentType || typeof e.sha256 !== "string" || e.sha256.length !== 64 || [...e.sha256].some(c => !"0123456789abcdef".includes(c)) || typeof e.bytes !== "number" || !Number.isSafeInteger(e.bytes) || e.bytes < 0)
      throw new InputTypeError("Invalid package entry metadata.");
    if (e.part !== "[Content_Types].xml" && normalizePartName(e.part) !== e.part) throw new InvalidContainerError("Inventory part names must be canonical.");
    inventoryPath(e.path, absolute);
    const partKey = e.part.normalize("NFC").toUpperCase().toLowerCase(), pathKey = decodeURIComponent(e.path).normalize("NFC").toUpperCase().toLowerCase();
    if (prior !== undefined && compareInventoryNames(prior, e.part) >= 0 || parts.has(partKey) || paths.has(pathKey)) throw new InvalidContainerError("Inventory records must be sorted and unambiguous.");
    prior = e.part; parts.add(partKey); paths.add(pathKey);
    total += e.bytes;
    if (!Number.isSafeInteger(total)) throw new ResourceLimitError("Inventory byte total exceeded.");
    budget.check("expandedPackage", total);
    if (e.part === "[Content_Types].xml" || e.contentType.toLowerCase().endsWith("+xml") || ["application/xml", "text/xml"].includes(e.contentType.toLowerCase())) budget.check("xmlPartBytes", e.bytes);
    budget.charge("retainedBytes", (e.part.length + e.path.length + e.contentType.length + 64) * 4 + 128);
    budget.charge("work", e.part.length + e.path.length + 1);
    return Object.freeze(e as unknown as PackageEntry);
  });
  const rawDirectories = input.directories === undefined ? undefined : sequence(input.directories);
  if (rawDirectories) budget.check("zipEntries", entries.length + rawDirectories.length);
  const directories = rawDirectories?.map(d => { inventoryPath(d, false); budget.charge("retainedBytes", d.length * 8 + 128); budget.charge("work", d.length + 1); return d; });
  if (directories) budget.check("zipEntries", entries.length + directories.length);
  return Object.freeze({ version: 1, kind: input.kind as "docx" | "dotx", dialect: input.dialect as "strict" | "transitional", entries: Object.freeze(entries), ...(directories ? { directories: Object.freeze(directories) } : {}), ...(input.selection === undefined ? {} : { selection: "all" as const }), ...(input.pretty === undefined ? {} : { pretty: input.pretty as boolean }) });
}

export const packageInventorySchema: DocxJsonSchema = {
  type: "object", required: ["version", "kind", "dialect", "entries"], additionalProperties: false,
  properties: { version: { const: 1 }, kind: { enum: ["docx", "dotx"] }, dialect: { enum: ["strict", "transitional"] },
    selection: { const: "all" }, pretty: { type: "boolean" }, directories: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    entries: { type: "array", minItems: 1, description: "Strictly increasing canonical part names in Unicode scalar order; paths and directory spellings must be unambiguous. Relative VFS paths require an explicitly granted inventoryDirectory; stdin uses absolute VFS paths.",
      items: { type: "object", required: ["part", "path", "contentType", "bytes", "sha256"], additionalProperties: false,
        properties: { part: { type: "string", minLength: 1, description: "Canonical absolute OPC part name, except literal [Content_Types].xml." }, path: { type: "string", minLength: 1 }, contentType: { type: "string", minLength: 1 }, bytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, sha256: { type: "string", minLength: 64, maxLength: 64, description: "Exact lowercase SHA-256 hexadecimal payload digest." } } } }
  }
};
