import { archiveSettings } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { stageTrackedText, type TrackedTextEdit } from "./tracked-text.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { UnsupportedEditError } from "./xml-write.js";

export type RevisionEditOptions = DocxOperationArguments<"revisions.add"> & { readonly input?: PublicationInput };
export interface RevisionEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "insert" | "remove"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
export async function editDocumentRevisions(input: Uint8Array, options: RevisionEditOptions, context: PublicationContext): Promise<RevisionEditData> {
  const settings = archiveSettings(context);
  const { input: identity, ...args } = options;
  const invocation = validateDocxInvocation({ operation: "revisions.add", inputs: [identity?.path ?? "document"], options: args }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"revisions.add">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const { kind, text, author, timestamp, all, allowEmpty, output, inPlace, force, dryRun, json, ...selection } = opts;
  delete selection.limit;
  const selected = resolveDocxSelection(document, { operation: "text.get", inputs: ["document"], options: selection });
  const targets: Location[] = [];
  for (const target of selected) if (["paragraph", "run"].includes(target.kind)) targets.push(target); else targets.push(...document.list("paragraph", { owner: target.token }));
  const chosen = document.select(targets, { ...(all === undefined ? {} : { all }), ...(allowEmpty === undefined ? {} : { allowEmpty }) }, "mutation");
  if (!chosen.length && !allowEmpty) throw new SelectionError("missing-selection");
  const archive = document.snapshot(); assertDocumentEditable(archive, { ...settings, budget });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const edits: TrackedTextEdit[] = [];
  for (const target of chosen) {
    if (!["paragraph", "run"].includes(target.kind)) throw new UnsupportedEditError("Tracked creation requires a paragraph or run text selection.");
    if (document.references(target.token).length > 1) throw new SelectionError("ambiguous-selection");
    const paragraph = target.kind === "paragraph" ? target : document.list("paragraph", { scope: "all-stories" }).find(location => location.value.story === target.value.story && location.value.path.every((i, n) => target.value.path[n] === i))!;
    const wholeToken = encodeLocation({ ...target.value, range: null });
    const length = [...document.text({ select: wholeToken }).text].length;
    const range = target.value.range ?? { start: kind === "insert" ? length : 0, end: length };
    if (kind === "insert" && range.start !== range.end || kind === "delete" && range.start === range.end) throw new UnsupportedEditError("Tracked creation requires a caret or a nonempty deletion range.");
    let offset = 0;
    if (target.kind === "run") for (const run of document.list("run", { owner: paragraph.token })) { if (run.token === target.token || run.value.path.every((i, n) => target.value.path[n] === i)) break; offset += [...document.text({ select: run.token }).text].length; }
    if (kind === "insert" && text === "" && allowEmpty) continue;
    edits.push({ paragraph, start: offset + range.start, end: offset + range.end, text: kind === "insert" ? text! : "" });
  }
  stageTrackedText(editor, edits, { author, timestamp }, budget, settings.limits);
  const changes = edits.map(edit => { const value = { ...edit.paragraph.value, generation: 1 }; return { kind: kind === "insert" ? "insert" as const : "remove" as const, before: edit.paragraph, after: { ...edit.paragraph, value, token: encodeLocation(value) } }; });
  const prospective = { changed: edits.length > 0, changes, output: dryRun ? null : { path: inPlace ? identity?.path ?? null : output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) }, dryRun: dryRun ?? false };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "revisions.add", ok: true, data: prospective, affected: changes.length, locations: changes.map(change => change.after), warnings: [], errors: [] }) + "\n").length);
  const published = await publishDocumentArchive(editor.snapshot(), { ...(identity ? { input: identity } : {}), ...(output === undefined ? {} : { output }), ...(inPlace === undefined ? {} : { inPlace }), ...(force === undefined ? {} : { force }), ...(dryRun === undefined ? {} : { dryRun }), ...(json === undefined ? {} : { json }) }, { ...context, budget });
  return { ...prospective, output: published.published.length ? { path: published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } : null };
}
