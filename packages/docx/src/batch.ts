import { archiveSettings, InputTypeError, type DocumentArchive } from "./archive.js";
import { validateDocxBatch, validateDocxInvocation, type DocxBatch } from "./command.js";
import { documentBatchActions } from "./batch-operations.js";
import { DocumentSession } from "./document-session.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { publishDocumentArchive, type PublicationContext, type PublicationOptions } from "./publication.js";
import type { ImageInsertionContext } from "./image-insertion.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import type { DocumentBudget } from "./budget.js";
import type { DocxBatchItem } from "./operation-types.js";

export interface DocumentBatchItemResult {
  readonly id: string;
  readonly version: 1;
  readonly operation: string;
  readonly ok: true;
  readonly data: unknown;
  readonly affected: number;
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly errors: readonly never[];
  readonly locations: readonly Location[];
}
export interface DocumentBatchData {
  readonly results: readonly DocumentBatchItemResult[];
  readonly publication: { readonly changed: boolean; readonly changes: readonly { readonly kind: "add" | "set" | "remove" | "replace"; readonly before: Location | null; readonly after: Location | null }[]; readonly dryRun: boolean; readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null } | null;
}
export interface DocumentBatchInput { readonly version: 1; readonly operations: readonly (DocxBatchItem & { readonly id?: string })[] }
export type DocumentBatchOptions = PublicationOptions & { readonly limit?: readonly { readonly name: import("./budget.js").DocumentLimitName; readonly value: number }[]; readonly author?: string; readonly timestamp?: string };

function rebaseLocations(value: unknown, generation: number, beforeGeneration: number, budget: DocumentBudget): unknown {
  budget.charge("work", 1);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => rebaseLocations(item, generation, beforeGeneration, budget));
  const record = value as Record<string, unknown>;
  if (typeof record.token === "string" && record.token.startsWith("docx-loc-v1.") && record.value && typeof record.value === "object") {
    const location = value as Location;
    const payload = { ...location.value, generation };
    return { ...location, value: payload, token: encodeLocation(payload) };
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, rebaseLocations(child, key === "before" ? beforeGeneration : generation, beforeGeneration, budget)]));
}

/** Syntax is admitted as a whole; effects stay local until the single outer publication. */
export async function executeDocumentBatch(input: Uint8Array, value: unknown, options: DocumentBatchOptions, context: PublicationContext & Pick<ImageInsertionContext, "binaryResolver">): Promise<DocumentBatchData> {
  const settings = archiveSettings(context);
  closedRecord(options, ["input", "output", "inPlace", "force", "dryRun", "json", "limit", "author", "timestamp"]);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new InputTypeError("Expected owned batch options.");
  if (options.input !== undefined) {
    closedRecord(options.input, ["path", "stat"]);
    if (!options.input.stat || typeof options.input.stat !== "object" || Reflect.ownKeys(options.input.stat).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(options.input!.stat, key)!, "value"))) throw new InputTypeError("Expected owned input identity.");
  }
  const { input: identity, ...operationOptions } = options;
  const initial = validateDocxBatch(value, settings.budget, { author: options.author, timestamp: options.timestamp });
  const invocation = validateDocxInvocation({ operation: "batch", inputs: [identity?.path ?? "document"], options: { ...operationOptions, ...initial } }, settings.budget);
  const batch = { version: 1, operations: invocation.options.operations } as DocxBatch;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  for (const item of batch.operations) if (!documentBatchActions.has(item.operation)) throw new UnsupportedProfileError("This operation is not implemented by the ordered utility batch executor.");
  budget.charge("batchOperations", batch.operations.length);
  if (!batch.operations.length) return { results: [], publication: null };
  const session = await DocumentSession.open(input, { ...context, ...settings, budget });
  const results: DocumentBatchItemResult[] = [];
  let changed = false;
  for (const [index, item] of batch.operations.entries()) {
    const id = item.id ?? `step${index + 1}`;
    try {
      await budget.checkpoint(1);
      const mutates = docxOperationSchemas[item.operation]!.mutates;
      const beforeGeneration = session.generation;
      const previousMatches = budget.usage.matches;
      const arguments_ = { ...item.arguments, ...(mutates ? { output: "-" } : {}) };
      const data = rebaseLocations(await documentBatchActions.get(item.operation)!(input, { ...item, arguments: arguments_ }, session.context), session.generation, beforeGeneration, budget);
      const record = data as { changed?: boolean; changes?: readonly { after?: Location | null }[]; items?: readonly { location?: Location }[]; item?: { location: Location }; warnings?: readonly { code: string; message: string }[] };
      const affected = mutates && record.changed !== false ? record.changes?.length ?? 0 : 0;
      const matches = mutates ? record.changes?.length ?? 0 : record.items?.length ?? (record.item ? 1 : 0);
      budget.charge("matches", Math.max(0, matches - (budget.usage.matches - previousMatches)));
      changed ||= record.changed === true;
      const locations = record.changes ? record.changes.flatMap(change => change.after ? [change.after] : []) : record.items?.flatMap(item => item.location ? [item.location] : []) ?? (record.item ? [record.item.location] : []);
      const resultData = item.operation === "properties.get" ? { item: record.items![0] } : item.operation === "properties.list" ? { items: record.items }
        : item.operation === "images.list" || item.operation === "images.get" ? Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([key]) => key !== "warnings")) : data;
      results.push({ id, version: 1, operation: item.operation, ok: true, data: resultData, warnings: record.warnings ?? [], errors: [], affected, locations });
      const size = new TextEncoder().encode(JSON.stringify(results)).length;
      budget.check("serializedOutput", size);
      budget.charge("retainedBytes", new TextEncoder().encode(JSON.stringify(results.at(-1))).length);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Document batch operation failed.", { cause });
      Object.assign(error, { operationIndex: index, operationId: id });
      throw error;
    }
  }
  const mutates = batch.operations.some(item => docxOperationSchemas[item.operation]!.mutates);
  const changes = results.flatMap(result => {
    const data = result.data as { changes?: readonly { kind: string; before?: Location | null; after?: Location | null }[] };
    return (data.changes ?? []).map(change => ({ kind: (change.kind === "insert" ? "add" : change.kind === "format" ? "set" : change.kind === "delete" ? "remove" : change.kind) as "add" | "set" | "remove" | "replace", before: change.before ?? null, after: change.after ?? null }));
  });
  const publication: DocumentBatchData["publication"] = mutates ? { changed, changes, dryRun: options.dryRun ?? false, output: null } : null;
  const prospective = { results, publication: publication ? { ...publication, output: options.dryRun ? null : { path: options.inPlace ? identity?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } } : null };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "batch", ok: true, data: prospective, warnings: [], errors: [], affected: results.reduce((sum, result) => sum + result.affected, 0), locations: [] }) + "\n").length);
  if (mutates) {
    const archive: DocumentArchive = await session.snapshot();
    const { limit: ignoredLimit, author: ignoredAuthor, timestamp: ignoredTimestamp, ...intent } = options;
    const published = await publishDocumentArchive(archive, intent, { ...context, ...settings, budget }, session.baseline);
    if (publication && published.published.length) Object.assign(publication, { output: { path: options.output === "-" ? null : published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } });
  }
  return { results: Object.freeze(results), publication };
}
