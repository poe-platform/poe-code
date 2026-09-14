import { archiveSettings, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { pathContains } from "./location-index.js";
import { SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { documentDialects } from "./dialect.js";
import { revisionInfo, type RevisionInfo } from "./revision-markup.js";
import { resolveDocxSelection } from "./simple-selection.js";

export interface RevisionListData {
  readonly view: "final" | "original" | "all";
  readonly items: readonly (RevisionInfo & { readonly location: Location })[];
}

export async function inspectDocumentRevisions(input: Uint8Array, options: DocxOperationArguments<"revisions.list">, context: ArchiveContext): Promise<RevisionListData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "revisions.list", inputs: ["document"], options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"revisions.list">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
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
