import { DocxUsageError } from "./argument-json.js";
import {
  contextData,
  modelContext,
  type AdmittedModelContext,
  type DocumentModelContext
} from "./model-context.js";
import { acquireDocumentTransportInput } from "./model-input.js";
import { validateDocxValue } from "./operation-schema.js";
import type { DocxBinaryInput, DocxTransportContext } from "./operation-types.js";

/** JSON is data. Only the supplied host adapters can resolve its capability tokens. */
export async function resolveDocumentModelContext(
  value: DocxTransportContext | undefined,
  host: DocumentModelContext = {}
): Promise<AdmittedModelContext> {
  const settings = modelContext(host);
  if (value === undefined) return settings;
  contextData(value, ["vfs", "limits", "timestamp", "author", "fonts", "template"]);
  if (value.limits !== undefined) contextData(value.limits);
  if (value.template !== undefined) contextData(value.template);
  if (!validateDocxValue("DocumentContext", value))
    throw new DocxUsageError("Expected declarative document context.");
  const record = {
    ...value,
    ...(value.limits ? { limits: { ...value.limits } } : {}),
    ...(value.template ? { template: { ...value.template } as DocxBinaryInput } : {})
  };
  if (record.vfs !== undefined && record.vfs !== settings.binaryResolver?.capability)
    throw new DocxUsageError("Unknown VFS capability token.");
  if (record.fonts !== undefined && record.fonts !== settings.fontResolver?.capability)
    throw new DocxUsageError("Unknown font capability token.");
  if (record.template !== undefined && settings.template !== undefined)
    throw new DocxUsageError("Conflicting context templates.");
  const { template, ...base } = settings;
  const budget = settings.budget.lower(record.limits ?? {}, settings.signal);
  const selected = modelContext({
    ...base,
    budget,
    limits: {
      ...settings.limits,
      maxEntryBytes: Math.min(settings.limits.maxEntryBytes, budget.limits.xmlPartBytes),
      maxDepth: Math.min(settings.limits.maxDepth, budget.limits.xmlDepth)
    },
    ...(record.author === undefined ? {} : { author: record.author }),
    ...(record.timestamp === undefined ? {} : { timestamp: new Date(record.timestamp) }),
    ...(record.vfs === undefined ? {} : { vfs: { open: settings.binaryResolver!.open } }),
    ...(record.fonts === undefined ? {} : { fonts: settings.fontResolver!.fonts })
  });
  const bytes =
    record.template === undefined
      ? template
      : await acquireDocumentTransportInput(record.template, selected);
  selected.budget.check("work", 0);
  return bytes === undefined ? selected : modelContext({ ...selected, template: bytes });
}
