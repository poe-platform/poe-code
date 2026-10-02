import { incomingResourceReferences } from "./ancillary-resources.js";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { pathContains } from "./location-index.js";
import { SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations, type DocumentLocations } from "./locations.js";
import type { DocumentBudget } from "./budget.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { documentDialects } from "./dialect.js";
import { revisionInfo, type RevisionInfo } from "./revision-markup.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { InvalidValueError } from "./archive.js";
import { DocumentPackage } from "./package.js";
import { storedIntegerIdentity } from "./stored-lexical.js";
import { reviewResourceDate, type ReviewResourceListData } from "./review-resources.js";

export interface RevisionListData {
  readonly view: "final" | "original" | "all";
  readonly items: readonly (RevisionInfo & { readonly location: Location })[];
}

export function inspectDocumentRevisions(input: Uint8Array, options: DocxOperationArguments<"revisions.list">, context: ArchiveContext, projection: "resource"): Promise<ReviewResourceListData>;
export function inspectDocumentRevisions(input: Uint8Array, options: DocxOperationArguments<"revisions.list">, context: ArchiveContext, projection?: "snapshot"): Promise<RevisionListData>;
export async function inspectDocumentRevisions(input: Uint8Array, options: DocxOperationArguments<"revisions.list">, context: ArchiveContext, projection: "snapshot" | "resource" = "snapshot"): Promise<RevisionListData | ReviewResourceListData> {
  if (projection !== "snapshot" && projection !== "resource") throw new InvalidValueError("Expected a declared revision projection.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "revisions.list", inputs: ["document"], options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"revisions.list">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const inventory = collectDocumentRevisions(document, { scope: "all-stories", ...opts }, budget);
  if (projection === "snapshot") return inventory;
  const graph = new DocumentPackage(document.snapshot(), settings.limits, budget);
  const references = new Map<string, ReturnType<typeof incomingResourceReferences>>();
  const items = inventory.items.map(revision => {
    budget.charge("retainedBytes", 1536);
    const identity = storedIntegerIdentity(revision.id ?? undefined);
    const revisionId = identity === undefined ? NaN : Number(identity);
    if (!Number.isFinite(revisionId) || !Number.isInteger(revisionId) || BigInt(revisionId).toString() !== identity)
      throw new InvalidValueError("Resource details require an exact numeric revision identity.");
    const part = revision.location.value.part;
    if (!references.has(part)) references.set(part, incomingResourceReferences(graph, part, budget));
    return { kind: "revisions" as const, location: revision.location, ...(revision.name === null ? {} : { name: revision.name }),
      properties: [
        { name: "id", type: "string" as const, value: revision.id, writable: false, cached: false },
        { name: "author", type: "string" as const, value: revision.author, writable: false, cached: false },
        { name: "timestamp", type: "date" as const, value: reviewResourceDate(revision.timestamp), writable: false, cached: false },
        { name: "stored_timestamp", type: "string" as const, value: revision.timestamp, writable: false, cached: false },
        ...(["markup", "namespace", "name", "type", "support"] as const).map(name => ({ name, type: "string" as const, value: revision[name], writable: false, cached: false }))
      ], references: references.get(part)!, support: revision.support === "opaque" ? "preserve" as const : "read" as const,
      details: { kind: "revisions" as const, revisionId, author: revision.author ?? "", timestamp: reviewResourceDate(revision.timestamp), type: revision.type }
    };
  });
  const data = { items };
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  budget.check("serializedOutput", size); budget.charge("retainedBytes", size);
  return data;
}

/** Inventory an already admitted immutable document within its invocation budget. */
export function collectDocumentRevisions(document: DocumentLocations, opts: DocxOperationArguments<"revisions.list">, budget: DocumentBudget): RevisionListData {
  const { revision, view = "all", select, ...scope } = opts;
  const target = select === undefined ? undefined : document.resolve(select);
  const selected = target?.kind === "annotation" ? [target] : resolveDocxSelection(document, { operation: "text.get", inputs: ["document"], options: { ...scope, ...(select === undefined ? {} : { select }) } });
  const editor = new DocumentArchiveEditor(document.snapshot(), {}, undefined, budget);
  let items: RevisionListData["items"][number][] = [];
  for (const location of document.list("annotation", { scope: "all-stories" })) {
    budget.charge("work", selected.length + location.value.path.length);
    if (!selected.some(s => s.value.story === location.value.story && (pathContains(s.value.path, location.value.path) || pathContains(location.value.path, s.value.path)))) continue;
    let node = editor.xml(location.value.part.slice(1)).root;
    let omitted = false;
    for (const i of location.value.path) {
      node = node.children[i]!;
      const ancestor = revisionInfo(node);
      omitted ||= view === "final" && (ancestor?.type === "delete" || ancestor?.markup.startsWith("moveFrom") === true) || view === "original" && (ancestor?.type === "insert" || ancestor?.markup.startsWith("moveTo") === true);
      if (node.localName === "tr" && (node.namespace === documentDialects.transitional.w || node.namespace === documentDialects.strict.w)) {
        const properties = node.children.find(child => child.namespace === node.namespace && child.localName === "trPr");
        omitted ||= properties?.children.some(child => child.namespace === node.namespace &&
          (view === "final" && child.localName === "del" || view === "original" && child.localName === "ins")) === true;
      }
    }
    if (omitted) continue;
    const info = revisionInfo(node);
    if (!info) continue;
    budget.check("matches", items.length + 1);
    budget.charge("retainedBytes", 512);
    items.push({ ...info, location });
  }
  if (revision !== undefined) {
    const item = items[revision - 1];
    if (!item) throw new SelectionError("missing-selection");
    items = [item];
  }
  if (target && !items.length) throw new SelectionError("missing-selection");
  const result = { view, items };
  const size = new TextEncoder().encode(JSON.stringify(result)).length;
  budget.check("serializedOutput", size); budget.charge("retainedBytes", size);
  return result;
}
