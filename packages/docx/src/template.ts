import { archiveSettings, documentSession, ResourceLimitError } from "./archive.js";
import type { DocumentBudget } from "./budget.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { ControlClonePlanner } from "./control-clone.js";
import { DocumentArchiveEditor } from "./package-write.js";
import type { XmlElement } from "./package-xml.js";
import { editDocumentControlRepeats, templateRepeatAdmission } from "./control-repeat.js";
import type { ControlTemplateData } from "./control-template-types.js";
import { editDocumentControls, inspectDocumentControls, prepareControlPlaceholder, type ControlSnapshot } from "./controls.js";
import { DocumentSession } from "./document-session.js";
import { pathContains } from "./location-index.js";
import { encodeLocation, SelectionError, type Location } from "./location-token.js";
import type { DocxOperationArguments, DocxTemplateRecord } from "./operation-types.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { UnsupportedEditError } from "./xml-write.js";

interface Declaration { readonly control: ControlSnapshot; readonly recipients: readonly ControlSnapshot[]; readonly fields: readonly Declaration[] }
const inside = (parent: Location, child: Location): boolean => parent.value.part === child.value.part && pathContains(parent.value.path, child.value.path);
function declarations(items: readonly ControlSnapshot[], budget: DocumentBudget, owner?: ControlSnapshot, depth = 0): Declaration[] {
  budget.charge("work", items.length + 1);
  let pathLength = 1;
  for (const item of items) pathLength = Math.max(pathLength, item.location.value.path.length);
  budget.charge("work", (items.length + 1) * (items.length + 1) * (32 + pathLength * 8));
  budget.charge("retainedBytes", (items.length + 1) * 512);
  if (depth > 4) throw new ResourceLimitError("Template repeat nesting limit exceeded.");
  const candidates = items.filter(item => (!owner || inside(owner.location, item.location) && owner !== item) && item.tag !== null && item.kind !== "repeating-item");
  const direct = candidates.filter(item => !candidates.some(parent => parent !== item && parent.kind === "repeating-section" && inside(parent.location, item.location)));
  const result: Declaration[] = [];
  for (const item of direct) {
    if (result.some(declaration => declaration.control.tag === item.tag)) continue;
    const recipients = direct.filter(candidate => candidate.tag === item.tag);
    if (recipients.some(candidate => candidate.kind !== item.kind || JSON.stringify(candidate.choices) !== JSON.stringify(item.choices)) || item.kind === "repeating-section" && recipients.length !== 1) throw new DocxUsageError("Template binding declarations conflict.");
    if (recipients.some(candidate => candidate.lock !== "unlocked" || candidate.binding !== null || candidate.support !== "supported")) throw new UnsupportedEditError("Template bindings must be admitted, unlocked and unbound.");
    let fields: Declaration[] = [];
    if (item.kind === "repeating-section") {
      const nativeItems = items.filter(candidate => candidate.kind === "repeating-item" && inside(item.location, candidate.location) && !items.some(parent => parent !== item && parent.kind === "repeating-section" && inside(item.location, parent.location) && inside(parent.location, candidate.location)));
      if (!nativeItems.length) throw new UnsupportedEditError("A template repeat requires a native prototype.");
      const schema = (fields: readonly Declaration[]): string => JSON.stringify(fields.map(field => ({ tag: field.control.tag, kind: field.control.kind, choices: field.control.choices, fields: JSON.parse(schema(field.fields)) })).sort((a, b) => a.tag! < b.tag! ? -1 : a.tag! > b.tag! ? 1 : 0));
      for (const nativeItem of nativeItems) {
        const candidate = declarations(items.filter(item => inside(nativeItem.location, item.location)), budget, nativeItem, depth + 1);
        if (nativeItem === nativeItems[0]) fields = candidate;
        else if (schema(candidate) !== schema(fields)) throw new DocxUsageError("Prior template items have conflicting binding schemas.");
      }
    }
    result.push({ control: item, recipients, fields });
  }
  return result;
}
function scalarOptions(item: ControlSnapshot, value: unknown): { readonly text: string } | { readonly checked: boolean } | { readonly choice: string } | { readonly date: string } {
  if (["plain-text", "rich-text"].includes(item.kind) && typeof value === "string") return { text: value };
  if (item.kind === "checkbox" && typeof value === "boolean") return { checked: value };
  if (["dropdown", "combo-box"].includes(item.kind) && typeof value === "string") return { choice: value };
  if (item.kind === "date" && typeof value === "string") return { date: value };
  throw new DocxUsageError("Template value conflicts with its declared control type.");
}
function validateRecord(record: DocxTemplateRecord, fields: readonly Declaration[], budget: DocumentBudget): void {
  budget.charge("work", (record.values.length + 1) * (fields.length + 1) * 16);
  if (record.values.length !== fields.length || record.values.some(value => !fields.some(field => field.control.tag === value.binding))) throw new DocxUsageError("Template records must exactly match their declared bindings.");
  for (const field of fields) {
    const value = record.values.find(value => value.binding === field.control.tag)!.value;
    if (field.control.kind === "repeating-section") {
      if (!Array.isArray(value)) throw new DocxUsageError("A declared repeat requires a record array.");
      if (value.length > 1000) throw new ResourceLimitError("Template repeat item limit exceeded.");
      budget.charge("matches", Math.max(1, value.length));
      for (const record of value) validateRecord(record, field.fields, budget);
    } else scalarOptions(field.control, value);
  }
}

/** Fill explicitly tagged body templates with typed records and one final publication. */
export async function applyDocumentTemplate(input: Uint8Array, options: DocxOperationArguments<"template.apply"> & { readonly input?: PublicationInput }, context: PublicationContext): Promise<ControlTemplateData> {
  const settings = archiveSettings(context), { input: identity, ...args } = options;
  const opts = validateDocxInvocation({ operation: "template.apply", inputs: [identity?.path ?? "document"], options: args }, settings.budget).options as DocxOperationArguments<"template.apply">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const bounded = { ...context, ...settings, budget };
  const session = context[documentSession] ?? await DocumentSession.open(input, bounded);
  const staged = { ...bounded, [documentSession]: session };
  const baseline = await session.read(input);
  assertDocumentEditable(baseline, staged, baseline);
  const initial = (await inspectDocumentControls(input, {}, staged)).items;
  const fields = declarations(initial, budget);
  const array = Array.isArray(opts.data);
  let values: DocxTemplateRecord;
  if (array) {
    const regions = fields.filter(field => field.control.kind === "repeating-section");
    if (regions.length !== 1) throw new SelectionError(regions.length ? "ambiguous-selection" : "missing-selection", regions.map(field => field.control.location.token));
    if (fields.length !== 1) throw new DocxUsageError("Top-level template arrays cannot omit singleton bindings.");
    values = { values: [{ binding: regions[0]!.control.tag!, value: opts.data as readonly DocxTemplateRecord[] }] };
  } else values = opts.data as DocxTemplateRecord;
  validateRecord(values, fields, budget);
  const repeated = fields.filter(field => field.control.kind === "repeating-section");
  if (repeated.length) {
    const editor = new DocumentArchiveEditor(baseline, {}, undefined, budget), planner = new ControlClonePlanner(baseline, staged);
    const child = (node: XmlElement, name: string, namespace = node.namespace) => node.children.find(child => child.namespace === namespace && child.localName === name);
    for (const item of initial.filter(item => repeated.some(region => inside(region.control.location, item.location)))) {
      const xml = editor.xml(item.location.value.part.slice(1)); let node = xml.root; const ancestors = [node];
      for (const index of item.location.value.path) { node = node.children[index]!; ancestors.push(node); }
      if (item.kind === "repeating-section") {
        const content = child(node, "sdtContent");
        if (!content?.children.length || content.children.some(item => item.namespace !== node.namespace || item.localName !== "sdt" || !child(item, "sdtPr") || !child(child(item, "sdtPr")!, "repeatingSectionItem", "http://schemas.microsoft.com/office/word/2012/wordml"))) throw new UnsupportedEditError("Every prior native repeat requires only declared reusable items.");
      } else if (item.kind === "repeating-item") {
        const body = child(node, "sdtContent"), regionParent = ancestors.at(-4);
        const row = regionParent?.namespace === node.namespace && regionParent.localName === "tbl";
        if (!body || !body.children.length || (row ? body.children.length !== 1 || body.children[0]!.localName !== "tr" || body.children[0]!.namespace !== node.namespace : body.children.some(block => block.namespace !== node.namespace || !(["p", "tbl"].includes(block.localName) || block.localName === "sdt" && child(block, "sdtPr") && child(child(block, "sdtPr")!, "repeatingSection", "http://schemas.microsoft.com/office/word/2012/wordml"))))) throw new UnsupportedEditError("Every prior native template item requires an admitted row/block shape.");
        planner.preflight(xml, node, item.location.value.part);
        await planner.admitMedia(xml, node, item.location.value.part);
      } else if (item.tag !== null && !["repeating-section", "picture"].includes(item.kind)) prepareControlPlaceholder(xml, node, item, staged);
    }
  }
  const changes: ControlTemplateData["changes"][number][] = [];
  const current = async (location: Location): Promise<ControlSnapshot> => {
    const item = (await inspectDocumentControls(input, {}, staged)).items.find(item => item.location.value.part === location.value.part && item.location.value.path.length === location.value.path.length && pathContains(location.value.path, item.location.value.path));
    if (!item) throw new UnsupportedEditError("A staged template declaration disappeared.");
    return item;
  };
  const fill = async (fields: readonly Declaration[], record: DocxTemplateRecord, top = false): Promise<void> => {
    // Descending paths keep sibling selections stable when scalar metadata changes.
    const ordered = [...fields].sort((a, b) => {
      const left = a.control.location.value.path, right = b.control.location.value.path;
      for (let index = 0; index < Math.min(left.length, right.length); index++) if (left[index] !== right[index]) return right[index]! - left[index]!;
      return right.length - left.length;
    });
    for (const field of ordered) {
      const value = record.values.find(value => value.binding === field.control.tag)!.value;
      const before = field.control.location;
      if (field.control.kind !== "repeating-section") {
        for (const recipient of [...field.recipients].reverse()) {
          const item = await current(recipient.location);
          const data = await editDocumentControls(input, { select: item.location.token, ...scalarOptions(item, value), dryRun: true }, staged);
          if (top) changes.push({ kind: "replace", before: recipient.location, after: data.changes[0]!.after });
        }
        continue;
      }
      const records = value as readonly DocxTemplateRecord[];
      const scalarRecords = records.map(record => ({ values: record.values.filter(value => !Array.isArray(value.value)) as readonly { binding: string; value: string | number | boolean }[] }));
      const region = await current(before);
      await editDocumentControlRepeats(input, { select: region.location.token, data: scalarRecords, dryRun: true }, { ...staged, [templateRepeatAdmission]: true });
      const inventory = (await inspectDocumentControls(input, {}, staged)).items;
      const items = inventory.filter(item => item.kind === "repeating-item" && inside(region.location, item.location) && !inventory.some(parent => parent.kind === "repeating-section" && parent.location.value.path.length > region.location.value.path.length && inside(region.location, parent.location) && inside(parent.location, item.location)));
      for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index]!;
        const nested = declarations(inventory.filter(candidate => inside(item.location, candidate.location)), budget, item).filter(field => field.control.kind === "repeating-section");
        const nestedRecord = records[index] ?? { values: nested.map(field => ({ binding: field.control.tag!, value: [] })) };
        await fill(nested, nestedRecord);
      }
      if (top) {
        const after = (await current(before)).location;
        changes.push({ kind: "replace", before, after });
      }
    }
  };
  await fill(fields, values, true);
  const final = await session.read(input);
  const data = { changed: changes.length > 0, changes: changes.map(change => {
    const value = { ...change.after.value, generation: session.generation };
    return { ...change, after: { ...change.after, value, token: encodeLocation(value) } };
  }), dryRun: opts.dryRun ?? false, output: null };
  const prospective = { ...data, output: opts.dryRun ? null : { path: opts.inPlace ? identity?.path ?? null : opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "template.apply", ok: true, data: prospective, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] })).length);
  const intent = {
    ...(opts.output === undefined ? {} : { output: opts.output }),
    ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }),
    ...(opts.force === undefined ? {} : { force: opts.force }),
    ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }),
    ...(opts.json === undefined ? {} : { json: opts.json }),
  };
  const published = await publishDocumentArchive(final, { ...intent, ...(identity ? { input: identity } : {}) }, bounded, baseline);
  return { ...data, output: published.published.length ? { path: published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } : null };
}
