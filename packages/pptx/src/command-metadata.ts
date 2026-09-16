import type { PptxCommandEngineOptions, PptxCommandRequest, PptxPublicationRequest } from "./command-engine.js";
import type { OfficeResult, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { metadataSchemas } from "./metadata-schema.js";
import { coreDefinition, mutateProperty, readProperties, type PropertyType } from "./properties.js";
import { sanitize as sanitizePresentation, type SanitizeCategory } from "./sanitize.js";
import { mutateTags, readTags, type TagOptions } from "./tags.js";
import { SelectionError } from "./selectors.js";

export interface MetadataArguments {
  operation: string;
  input?: string;
  scope?: string;
  token?: string;
  slide?: number;
  metadataName?: string;
  metadataValue?: string;
  metadataType?: string;
  metadataRemove?: string;
  output?: string;
  json: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  all?: boolean;
  allowEmpty?: boolean;
}
function usage(message: string): never { throw new OfficeError("invalid-value", message, "usage"); }
function removalCategories(value: string | undefined): SanitizeCategory[] {
  const categories = ["notes", "comments", "properties", "links", "objects"];
  let parsed: unknown = value;
  if (value !== undefined && !categories.includes(value)) {
    try { parsed = JSON.parse(value); } catch { usage("Remove requires a category or a JSON array of categories."); }
  }
  const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (!values.length || values.some(item => typeof item !== "string" || !categories.includes(item)) || new Set(values).size !== values.length) usage("Remove requires distinct notes, comments, properties, links or objects categories.");
  return values as SanitizeCategory[];
}
export function validateMetadataCommand(args: MetadataArguments, positionals: readonly string[], seen: ReadonlySet<string>): void {
  const allowed = Object.keys(metadataSchemas[args.operation]!.options.properties).map(key => "--" + [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join(""));
  if ([...seen].some(flag => !allowed.includes(flag))) usage("Option does not apply to this metadata operation.");
  if (positionals.length !== 1 || !positionals[0]) usage("Metadata operations require exactly one input.");
  args.input = positionals[0];
  const tags = args.operation.startsWith("tags."), sanitize = args.operation === "sanitize";
  const action = args.operation.split(".")[1];
  if (args.scope !== undefined && !(tags ? ["slides", "presentation"] : ["presentation"]).includes(args.scope)) usage("Unsupported metadata scope.");
  if (args.token && ["--slide", "--scope", "--all"].some(flag => seen.has(flag))) usage("Opaque and simple selectors cannot be combined.");
  if (args.scope === "presentation" && args.slide !== undefined) usage("Presentation scope rejects slide selection.");
  if (!tags && !sanitize && action !== "list" && !args.metadataName) usage("Property name is required.");
  if (args.metadataName === "") usage("Metadata names cannot be empty.");
  if (action === "add" && (!args.metadataName || args.metadataValue === undefined)) usage("New tags require name and value.");
  if (action === "set" && (tags ? args.metadataName === undefined && args.metadataValue === undefined : args.metadataValue === undefined)) usage("Metadata edit value is required.");
  if (args.metadataType !== undefined && !["string", "number", "boolean", "date"].includes(args.metadataType)) usage("Unknown property type.");
  if (sanitize) removalCategories(args.metadataRemove);
  if (!sanitize && ["list", "get"].includes(action!)) return;
  if (tags && !args.token && args.slide === undefined && args.scope !== "presentation" && !args.all) throw new SelectionError("missing-selection");
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an output destination.");
  if (args.output === args.input && args.output !== "-") usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun) usage("Binary stdout cannot be combined with JSON.");
}
export async function executeMetadataCommand(args: MetadataArguments, request: PptxCommandRequest, options: PptxCommandEngineOptions): Promise<{ result: OfficeResult<unknown>; human: string; binary?: Uint8Array; publication?: PptxPublicationRequest }> {
  const context = { ...options.context, signal: request.signal };
  const original = await request.readInput(args.input!, Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes));
  const tags = args.operation.startsWith("tags."), sanitize = args.operation === "sanitize";
  const action = args.operation.split(".")[1];
  const tagOptions: TagOptions = {
    ...(args.scope === undefined ? {} : { scope: args.scope as "slides" | "presentation" }),
    ...(args.token ? { selection: { token: args.token } } : args.slide === undefined ? args.all ? { selection: { all: true } } : {} : { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: args.slide }, ...(args.all ? { all: true } : {}) } })
  };
  const envelope = (data: unknown, affected = 0, locations: readonly Location[] = []): OfficeResult<unknown> => ({ version: 1, operation: args.operation, ok: true, data, affected, warnings: [], errors: [], locations });
  if (!sanitize && ["list", "get"].includes(action!)) {
    const records = tags ? await readTags(original, tagOptions, context) : await readProperties(original, args.metadataName === undefined ? {} : { name: args.metadataName }, context);
    if (action === "get" && records.length !== 1) throw new SelectionError(records.length ? "ambiguous-selection" : "missing-selection");
    return { result: envelope({ [tags ? "tags" : "properties"]: records }, 0, tags ? (records as Awaited<ReturnType<typeof readTags>>).map(r => r.location) : []), human: records.map(r => `${JSON.stringify(r.name)}: ${JSON.stringify(r.value)}\n`).join("") };
  }
  let bytes: Uint8Array, affected: number, locations: readonly Location[] = [];
  let sanitization: Awaited<ReturnType<typeof sanitizePresentation>> | undefined;
  if (tags) {
    const result = await mutateTags(original, action as "add" | "set" | "remove", { ...tagOptions, ...(args.metadataName === undefined ? {} : { name: args.metadataName }), ...(args.metadataValue === undefined ? {} : { value: args.metadataValue }), ...(args.allowEmpty === undefined ? {} : { allowEmpty: args.allowEmpty }) }, context);
    bytes = result.bytes; affected = result.affected; locations = result.locations;
  } else if (sanitize) {
    sanitization = await sanitizePresentation(original, { remove: removalCategories(args.metadataRemove), ...(args.allowEmpty === undefined ? {} : { allowEmpty: args.allowEmpty }) }, context);
    bytes = sanitization.bytes; affected = sanitization.affected;
  } else {
    const known = await readProperties(original, { name: args.metadataName! }, context);
    if (known.length > 1) throw new SelectionError("ambiguous-selection");
    const type = args.metadataType ?? known[0]?.type ?? coreDefinition(args.metadataName!)?.[2];
    let value: string | number | boolean | undefined = args.metadataValue;
    if (action === "set" && type === "boolean") {
      if (value !== "true" && value !== "false") usage("Boolean properties require true or false.");
      value = value === "true";
    } else if (action === "set" && type === "number") {
      try { value = JSON.parse(args.metadataValue!) as unknown as number; } catch { usage("Number properties require a finite JSON number."); }
      if (typeof value !== "number" || !Number.isFinite(value)) usage("Number properties require a finite JSON number.");
    }
    bytes = (await mutateProperty(original, action as "set" | "remove", { name: args.metadataName!, ...(action === "set" ? { value: value!, ...(type === undefined ? {} : { type: type as PropertyType }) } : {}) }, context)).bytes;
    affected = 1;
  }
  const dryRun = args.dryRun ?? false, destination = args.inPlace ? args.input! : args.output;
  if (destination && destination !== "-" && !request.publishOutput) throw Object.assign(new Error("Output publication capability is unavailable."), { code: "publication-unsupported" });
  return {
    result: { ...envelope({ dryRun, ...(sanitization === undefined ? {} : { removed: sanitization.removed, retained: sanitization.retained }) }, affected, locations), warnings: sanitization?.warnings.map(message => ({ code: "retained-content", message, context: { phase: "validate-result" as const } })) ?? [] },
    human: sanitization === undefined ? `${dryRun ? "Validated" : "Updated"} ${affected} metadata item(s)\n` : `${dryRun ? "Validated removal of" : "Removed"} ${affected} selected item(s)\nRetained ${sanitization.retained.length} reported item(s); unrecognized hidden data may remain.\n${sanitization.retained.map(entry => `Retained ${entry.category} ${entry.kind} ${JSON.stringify(entry.part)}: ${entry.reason}\n`).join("")}`,
    ...(destination === "-" && !dryRun ? { binary: bytes } : {}),
    ...(destination && destination !== "-" ? { publication: { inputPath: args.input!, outputPath: destination, bytes, originalBytes: original, inPlace: args.inPlace ?? false, force: args.force ?? false, dryRun } } : {})
  };
}
