import { archiveSettings, InputTypeError } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { closedRecord, SelectionError } from "./location-token.js";
import { inspectDocumentProperties, editDocumentProperties } from "./document-properties.js";
import { inspectDocumentComments, editDocumentComments } from "./comments.js";
import { editDocumentRevisionDecisions } from "./revision-decisions.js";
import { inspectDocumentLinks, editDocumentLinks } from "./links.js";
import { publishDocumentArchive, assertDocumentEditable, type PublicationContext, type PublicationInput } from "./publication.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { UnsupportedEditError } from "./xml-write.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { DocxUsageError } from "./argument-json.js";
import { prepareObjectSanitization } from "./object-sanitization.js";

const categories = ["properties", "comments", "revisions", "links", "objects"] as const;
type Category = typeof categories[number];
export interface SanitizationData {
  readonly changed: boolean;
  readonly actions: readonly { readonly category: Category; readonly action: string; readonly affected: number; readonly records: readonly string[] }[];
  readonly retained: readonly Category[];
  readonly gaps: readonly string[];
  readonly removedParts: readonly string[];
  readonly removedRelationships: readonly { readonly owner: string; readonly id: string }[];
  readonly dryRun: boolean;
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
}

/** Applies only declared categories to isolated bytes before one validated publication. */
export async function sanitizeDocument(input: Uint8Array, options: DocxOperationArguments<"sanitize"> & { readonly input?: PublicationInput }, context: PublicationContext & { readonly admitSanitization?: (data: SanitizationData) => void }): Promise<SanitizationData> {
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected admitted document bytes.");
  closedRecord(options, ["remove", "revisionPolicy", "input", "output", "inPlace", "force", "dryRun", "allowEmpty", "json", "limit"]);
  const { input: identity, ...args } = options;
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation: "sanitize", inputs: ["document"], options: args }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"sanitize">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  budget.check("compressedInput", input.length); budget.charge("retainedBytes", input.length);
  const original = new Uint8Array(input), baseline = await readDocumentArchive(original, { ...settings, budget });
  assertDocumentEditable(baseline, { ...settings, budget });
  let staged = original;
  const actions: SanitizationData["actions"][number][] = [];
  const gaps = ["Unselected categories, inactive or unknown markup and unrelated package data are retained.", "No comprehensive privacy or recoverability removal is provided."];
  if (opts.remove.includes("revisions")) await editDocumentRevisionDecisions(original, { operation: opts.revisionPolicy === "accept" ? "revisions.accept" : "revisions.reject", options: { all: true, allowEmpty: true, scope: "all-stories", dryRun: true } }, { ...settings, budget, encoding: context.encoding });
  const preflight = { ...settings, budget, encoding: context.encoding };
  if (opts.remove.includes("properties")) {
    const inventory = await inspectDocumentProperties(original, {}, preflight);
    for (const item of inventory.items.filter(item => item.support === "edit")) await editDocumentProperties(original, { operation: "properties.remove", name: item.name!, dryRun: true }, preflight);
  }
  if (opts.remove.includes("comments")) await editDocumentComments(original, { operation: "comments.remove", options: { all: true, allowEmpty: true, dryRun: true } }, preflight);
  if (opts.remove.includes("links")) {
    const inventory = await inspectDocumentLinks(original, { scope: "all-stories" }, preflight);
    for (const item of inventory.items.filter(item => item.address !== "")) await editDocumentLinks(original, { operation: "links.remove", options: { select: item.location.token, dryRun: true } }, preflight);
  }
  if (opts.remove.includes("objects")) await prepareObjectSanitization(original, preflight);
  // Intermediate editors publish solely to a private byte sink; no caller I/O is available.
  async function stage(edit: (scope: PublicationContext) => Promise<{ readonly changes: readonly unknown[] }>): Promise<number> {
    const chunks: Uint8Array[] = [];
    const result = await edit({ ...settings, budget, encoding: context.encoding, stdout: { async write(bytes) { budget.charge("retainedBytes", bytes.length); chunks.push(new Uint8Array(bytes)); } } });
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    budget.charge("retainedBytes", length); staged = new Uint8Array(length);
    let offset = 0; for (const chunk of chunks) { staged.set(chunk, offset); offset += chunk.length; }
    return result.changes.length;
  }
  for (const category of categories.filter(item => opts.remove.includes(item))) {
    let affected = 0, action: string;
    const records: string[] = [];
    if (category === "properties") {
      action = "remove-supported-properties";
      const inventory = await inspectDocumentProperties(staged, {}, { ...settings, budget });
      if (inventory.items.some(item => item.support !== "edit")) gaps.push("Cached, invalid, opaque or ambiguously owned properties are retained.");
      for (const item of inventory.items.filter(item => item.support === "edit")) { affected += await stage(scope => editDocumentProperties(staged, { operation: "properties.remove", name: item.name!, output: "-" }, scope)); records.push(item.name!); }
    } else if (category === "comments") {
      action = "remove-supported-comments-and-markers";
      const inventory = await inspectDocumentComments(staged, { operation: "comments.list", options: {} }, { ...settings, budget });
      if (inventory.issues.length) throw new UnsupportedEditError("Comment structures cannot be sanitized safely.");
      if (inventory.items.length) affected = await stage(scope => editDocumentComments(staged, { operation: "comments.remove", options: { all: true, output: "-" } }, scope));
      records.push(...inventory.items.map(item => String(item.comment_id)));
      gaps.push("Empty comment parts and unrelated comment resources may remain.");
    } else if (category === "revisions") {
      action = opts.revisionPolicy === "accept" ? "accept-supported-revisions" : "reject-supported-revisions";
      affected = await stage(async scope => {
        const result = await editDocumentRevisionDecisions(staged, { operation: opts.revisionPolicy === "accept" ? "revisions.accept" : "revisions.reject", options: { all: true, allowEmpty: true, scope: "all-stories", output: "-" } }, scope);
        records.push(...result.changes.map(change => change.before.token)); return result;
      });
    } else if (category === "links") {
      action = "unwrap-external-hyperlinks-preserving-labels";
      for (;;) {
        const inventory = await inspectDocumentLinks(staged, { scope: "all-stories" }, { ...settings, budget });
        const item = inventory.items.find(item => item.address !== ""); if (!item) break;
        affected += await stage(scope => editDocumentLinks(staged, { operation: "links.remove", options: { select: item.location.token, output: "-" } }, scope));
        records.push(item.location.token);
      }
      gaps.push("Internal anchors, field instructions and external bindings other than supported hyperlinks are retained.");
    } else {
      action = "remove-supported-inert-object-carriers";
      const prepared = await prepareObjectSanitization(staged, { ...settings, budget, encoding: context.encoding });
      records.push(...prepared.records); gaps.push(...prepared.gaps);
      affected = await stage(async scope => { await publishDocumentArchive(prepared.archive, { output: "-" }, scope); return { changes: records }; });
    }
    actions.push({ category, action, affected, records });
  }
  const changed = actions.some(action => action.affected > 0); if (!changed && !opts.allowEmpty) throw new SelectionError("missing-selection");
  const archive = await readDocumentArchive(staged, { ...settings, budget });
  const removedParts = baseline.package.parts.filter(part => !archive.package.parts.some(next => next.partname === part.partname)).map(part => part.partname);
  const removedRelationships = ["/", ...baseline.package.parts.filter(part => !part.content_type.endsWith("relationships+xml")).map(part => part.partname)].flatMap(owner => baseline.package.relationships(owner).filter(edge => !archive.package.parts.some(part => part.partname === owner) && owner !== "/" || !archive.package.relationships(owner).some(next => next.rId === edge.rId)).map(edge => ({ owner, id: edge.rId })));
  const data: SanitizationData = { changed, actions, retained: categories.filter(item => !opts.remove.includes(item)), gaps, removedParts, removedRelationships, dryRun: opts.dryRun ?? false, output: null };
  measurePackageResourceSerialization({ ...data, output: { path: opts.output ?? identity?.path ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } }, budget);
  if (context.admitSanitization) {
    const planned = Object.freeze({ ...data, actions: Object.freeze(actions.map(action => Object.freeze({ ...action, records: Object.freeze([...action.records]) }))), retained: Object.freeze([...data.retained]), gaps: Object.freeze([...gaps]), removedParts: Object.freeze([...removedParts]), removedRelationships: Object.freeze(removedRelationships.map(edge => Object.freeze({ ...edge }))), output: opts.dryRun ? null : Object.freeze({ path: opts.inPlace ? identity?.path ?? null : opts.output === "-" ? null : opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) }) });
    const admitted = (context.admitSanitization as (data: SanitizationData) => unknown)(planned);
    if (admitted !== undefined) { void Promise.resolve(admitted).catch(() => {}); throw new DocxUsageError("Sanitization admission must be synchronous and return undefined."); }
  }
  const published = await publishDocumentArchive(archive, { ...(identity ? { input: identity } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) }, { ...context, budget }, baseline, changed ? undefined : original);
  return { ...data, output: published.published.length ? { path: published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } : null };
}
