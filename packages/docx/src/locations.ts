import { archiveSettings, InputTypeError, InvalidValueError, ResourceLimitError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { DocumentBudget } from "./budget.js";
import { LocationIndex, addressKey, documentScopes, pathContains, type DocumentScope, type LocationEntry, type StoryReference } from "./location-index.js";
import { closedRecord, decodeLocation, encodeLocation, safeOrdinal, SelectionError,
  type Location, type LocationKind, type LocationPayload } from "./location-token.js";
import { readTextSegments, type TextData } from "./text-traversal.js";
import type { TextOptions } from "./text.js";
import { resolveDocxSelection } from "./simple-selection.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";
import type { ShapeCarrier } from "./shape-carriers.js";

export interface LocationQuery { readonly scope?: DocumentScope; readonly owner?: string; readonly section?: number; readonly variant?: "default" | "first" | "even"; }
export interface MatchOptions {
  readonly first?: boolean;
  readonly all?: boolean;
  readonly occurrence?: number;
  readonly allowEmpty?: boolean;
}
export interface LocationMutationOptions extends MatchOptions { readonly shared?: boolean; }
export type LocationAddress = Pick<LocationPayload, "part" | "story" | "path" | "range">;
export interface LocationUpdate { readonly before: string; readonly after: LocationAddress | null; }
export interface LocationMutationResult {
  readonly affected: number;
  readonly locations: readonly Location[];
  readonly changes: readonly { readonly before: Location; readonly after: Location | null }[];
}
export type LocationStage = (editor: DocumentArchiveEditor, selected: readonly Location[]) => readonly LocationUpdate[];

function options(value: MatchOptions, mode: "read" | "mutation" | "text"): void {
  closedRecord(value, ["first", "all", "occurrence", "allowEmpty"]);
  for (const key of ["first", "all", "allowEmpty"] as const)
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new InvalidValueError("Expected boolean selection switches.");
  if (value.occurrence !== undefined) safeOrdinal(value.occurrence);
  const count = Number(value.first === true) + Number(value.all === true) + Number(value.occurrence !== undefined);
  if (count > 1 || (mode === "text" && count !== 1)) throw new InvalidValueError("Expected one explicit match cardinality.");
  if (mode === "read" && value.allowEmpty !== undefined) throw new InvalidValueError("allowEmpty is a mutation option.");
}

export async function openDocumentLocations(input: Uint8Array, context: ArchiveContext, mode: "editing" | "inventory" = "editing"): Promise<DocumentLocations> {
  if (mode !== "editing" && mode !== "inventory") throw new InvalidValueError("Expected an editing or read-only inventory location view.");
  const { limits, budget, signal } = archiveSettings(context);
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  if (input.length > limits.maxArchiveBytes) throw new ResourceLimitError("Document input limit exceeded.");
  budget.charge("retainedBytes", input.length);
  budget.charge("work", input.length);
  const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, { limits, budget, signal });
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  budget.check("work", 0);
  const sourceSha256 = [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return new DocumentLocations(archive, sourceSha256, { limits, budget, signal }, mode);
}

/** Revision-bound engine primitive; stage callbacks are trusted engine code, never document data. */
class DocumentLocations {
  #archive: DocumentArchive;
  #index: LocationIndex;
  #generation = 0;
  #mutating = false;
  readonly #sourceSha256: string;
  readonly #admission: Pick<AdmittedDocumentArchive, "mainPart" | "dialect">;
  readonly #context: ArchiveContext;
  readonly #budget: DocumentBudget;
  readonly #inventory: boolean;

  constructor(archive: AdmittedDocumentArchive, sourceSha256: string, context: ArchiveContext, mode: "editing" | "inventory") {
    const settings = archiveSettings(context);
    this.#context = { limits: settings.limits, signal: settings.signal, budget: settings.budget };
    this.#budget = settings.budget;
    this.#sourceSha256 = sourceSha256;
    this.#admission = { mainPart: archive.mainPart, dialect: archive.dialect };
    this.#inventory = mode === "inventory";
    this.#archive = this.#inventory ? this.#copyArchive(archive) : new DocumentArchiveEditor(archive, {}, undefined, this.#budget).snapshot();
    this.#index = new LocationIndex(this.#archive, settings.limits, archive.mainPart, archive.dialect, this.#budget);
  }

  get generation(): number { return this.#generation; }

  text(options: TextOptions = {}): TextData {
    const selected = resolveDocxSelection(this, { operation: "text.get", inputs: ["document"], options });
    const budget = this.#budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
    return readTextSegments(this.#index, selected, options.view ?? "final", entry => this.#location(entry), budget);
  }

  #location(entry: LocationEntry, range: LocationPayload["range"] = null): Location {
    const value: LocationPayload = { version: 1, sourceSha256: this.#sourceSha256, generation: this.#generation,
      part: entry.part, story: entry.story, path: entry.path, range };
    const token = encodeLocation(value);
    this.#budget.charge("retainedBytes", token.length * 4);
    this.#budget.charge("work", token.length);
    return Object.freeze({ kind: entry.kind, token, value: decodeLocation(token), positions: Object.freeze({ ...entry.positions }) });
  }

  #entry(value: LocationPayload, kind?: LocationKind): LocationEntry {
    this.#budget.charge("work", value.path.length + 1);
    if (value.sourceSha256 !== this.#sourceSha256 || value.generation !== this.#generation)
      throw new SelectionError("stale-selection");
    const entry = this.#index.byAddress.get(addressKey(value))?.find(entry => kind === undefined || entry.kind === kind);
    if (!entry || (value.range !== null && !this.#index.validRange(entry, value.range.start, value.range.end)))
      throw new SelectionError("stale-selection");
    return entry;
  }

  resolve<K extends LocationKind = LocationKind>(token: string, kind?: K): Location<K> {
    const value = decodeLocation(token);
    return this.#location(this.#entry(value, kind), value.range) as Location<K>;
  }

  shapeStory(token: string): Location<"story"> {
    const value = decodeLocation(token);
    const shape = this.#entry(value, "shape");
    if (value.range !== null) throw new InvalidValueError("A shape owner requires a whole occurrence token.");
    const bodies = this.list("story", { owner: token });
    if (bodies.length > 1 || !bodies.length && (this.#index.shapeCarriers.get(shape.node!)?.refusalReasons.length ?? 0) > 0)
      throw new UnsupportedEditError("The shape has no unambiguous supported text body.");
    if (!bodies[0]) throw new SelectionError("missing-selection");
    return bodies[0];
  }

  shapeCarrier(token: string): ShapeCarrier {
    const value = decodeLocation(token);
    const entry = this.#entry(value, "shape");
    if (value.range !== null) throw new InvalidValueError("A shape requires a whole occurrence token.");
    const carrier = this.#index.shapeCarriers.get(entry.node!);
    if (!carrier) throw new SelectionError("missing-selection");
    return carrier;
  }

  list<K extends LocationKind>(kind: K, query: LocationQuery = {}): readonly Location<K>[] {
    closedRecord(query, ["scope", "owner", "section", "variant"]);
    if (query.section !== undefined) safeOrdinal(query.section);
    if (query.variant !== undefined && !["default", "first", "even"].includes(query.variant))
      throw new InvalidValueError("Unknown story variant.");
    if (query.variant !== undefined && query.scope !== "headers" && query.scope !== "footers")
      throw new InvalidValueError("Story variants require header or footer scope.");
    if (query.section !== undefined && (kind === "part" || query.scope !== undefined && !["body", "headers", "footers", "all-stories"].includes(query.scope)))
      throw new InvalidValueError("Section selection requires body, header or footer scope.");
    if (!["section", "part", "story", "paragraph", "run", "table", "cell", "image", "shape", "link", "bookmark", "field", "annotation", "control"].includes(kind))
      throw new InvalidValueError("Unknown location kind.");
    if (query.scope !== undefined && (!documentScopes.includes(query.scope) || kind === "part"))
      throw new InvalidValueError("Unknown or inapplicable story scope.");
    if (query.owner !== undefined && (query.scope !== undefined || query.section !== undefined || query.variant !== undefined)) throw new InvalidValueError("An owner token cannot be combined with scope.");
    const owner = query.owner === undefined ? undefined : decodeLocation(query.owner);
    let shapeStories: readonly XmlElement[] | undefined;
    if (owner) {
      if (owner.range) throw new InvalidValueError("A resource owner cannot be a text range.");
      const entry = this.#entry(owner);
      if (kind === "shape" && !["story", "table", "cell", "paragraph", "run"].includes(entry.kind))
        throw new InvalidValueError("Shape occurrences require an admitted story, table, cell, paragraph or run owner; sections use an explicit numeric query.");
      if (kind === "story" && entry.kind === "shape") shapeStories = this.#index.shapeBodies.get(entry.node!) ?? [];
      if (kind === "part" || (kind === "run" && entry.kind !== "paragraph") ||
        (kind === "cell" && entry.kind !== "table") ||
        (["paragraph", "table"].includes(kind) && !["story", "cell"].includes(entry.kind)))
        throw new InvalidValueError("Invalid location owner chain.");
    }
    const scope = query.scope ?? "body";
    const referencedStories = new Set(this.#index.references.filter(ref =>
      (query.section === undefined || ref.section === query.section) &&
      (query.variant === undefined || ref.variant === query.variant)).map(ref => ref.story));
    this.#budget.charge("work", this.#index.references.length);
    const result: Location<K>[] = [];
    const shapeOrdinals = new Map<string, number>();
    for (const entry of this.#index.entries) {
      this.#budget.charge("work", 1);
      if (entry.kind !== kind) continue;
      if (owner ? entry.part !== owner.part || (shapeStories ? !shapeStories.includes(entry.node!) : entry.story !== owner.story || !pathContains(owner.path, entry.path))
        : kind !== "part" && scope !== "all-stories" && entry.scope !== scope) continue;
      if (query.section !== undefined || query.variant !== undefined) {
        const storyScoped = entry.scope === "headers" || entry.scope === "footers";
        if (storyScoped ? !referencedStories.has(entry.story) : query.section !== undefined && entry.positions.section !== query.section) continue;
      }
      this.#budget.check("matches", result.length + 1);
      const shapeOrdinal = kind === "shape" ? (shapeOrdinals.get(entry.story) ?? 0) + 1 : undefined;
      if (shapeOrdinal !== undefined) {
        if (!shapeOrdinals.has(entry.story)) this.#budget.charge("retainedBytes", 32);
        shapeOrdinals.set(entry.story, shapeOrdinal);
      }
      const position = shapeOrdinal !== undefined ? { shape: shapeOrdinal } : ["paragraph", "run", "table", "image", "link", "bookmark", "field", "control"].includes(kind) ? { [kind]: result.length + 1 } : {};
      result.push(this.#location({ ...entry, positions: { ...entry.positions, ...position, ...(query.section !== undefined ? { section: query.section } : {}) } }) as Location<K>);
    }
    return Object.freeze(result);
  }

  at<K extends LocationKind>(kind: K, position: number, query: LocationQuery = {}): Location<K> {
    safeOrdinal(position);
    if (kind === "run" && query.owner === undefined) throw new InvalidValueError("Run positions require a paragraph owner.");
    const listed = this.list(kind, query);
    if (kind === "shape") {
      const candidates = listed.filter(location => location.positions.shape === position);
      if (candidates.length > 1) {
        this.#budget.charge("diagnosticBytes", candidates.reduce((sum, location) => sum + location.token.length, 0));
        throw new SelectionError("ambiguous-selection", candidates.map(location => location.token));
      }
      if (!candidates[0]) throw new SelectionError("missing-selection");
      return candidates[0];
    }
    const result = listed[position - 1];
    if (!result) throw new SelectionError("missing-selection");
    return result;
  }

  cell(tableToken: string, coordinate: string): Location<"cell"> {
    const value = decodeLocation(tableToken);
    const entry = this.#entry(value, "table");
    if (value.range !== null) throw new InvalidValueError("A cell owner must be a table.");
    return this.#location(this.#index.cell(entry, coordinate)) as Location<"cell">;
  }

  range(token: string, start: number, end: number): Location {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
      throw new InvalidValueError("Expected a half-open Unicode scalar range.");
    const value = decodeLocation(token);
    const entry = this.#entry(value);
    if (!this.#index.validRange(entry, start, end)) throw new SelectionError("missing-selection");
    return this.#location(entry, { start, end });
  }

  select(candidates: readonly Location[], selection: MatchOptions = {}, mode: "read" | "mutation" | "text" = "read"): readonly Location[] {
    if (!["read", "mutation", "text"].includes(mode)) throw new InvalidValueError("Unknown selection mode.");
    options(selection, mode);
    if (!Array.isArray(candidates)) throw new InputTypeError("Expected candidate locations.");
    this.#budget.check("matches", candidates.length);
    const seen = new Set<string>();
    const resolved: Location[] = [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.token !== "string") throw new InputTypeError("Expected a location token.");
      const item = this.resolve(candidate.token, candidate.kind);
      if (!seen.has(item.token)) { seen.add(item.token); resolved.push(item); }
    }
    if (selection.occurrence !== undefined && selection.occurrence > resolved.length)
      throw new SelectionError("missing-selection");
    if (!resolved.length) {
      if (mode === "read" || selection.allowEmpty === true) return Object.freeze([]);
      throw new SelectionError("missing-selection");
    }
    if (selection.first) return Object.freeze(resolved.slice(0, 1));
    if (selection.occurrence !== undefined) return Object.freeze([resolved[selection.occurrence - 1]!]);
    if (selection.all || mode === "read") return Object.freeze(resolved);
    if (resolved.length > 1) {
      const tokens = resolved.map(item => item.token);
      this.#budget.charge("diagnosticBytes", tokens.reduce((sum, token) => sum + token.length, 0));
      throw new SelectionError("ambiguous-selection", tokens);
    }
    return Object.freeze(resolved);
  }

  sharedImages(token: string): readonly Location<"image">[] {
    const entry = this.#entry(decodeLocation(token), "image");
    const target = this.#index.imageTargets.get(entry.node!);
    if (!target) throw new InvalidValueError("Shared replacement requires an embedded image resource.");
    const result: Location<"image">[] = [];
    for (const candidate of this.#index.entries) {
      this.#budget.charge("work", 1);
      if (candidate.kind !== "image" || this.#index.imageTargets.get(candidate.node!) !== target) continue;
      this.#budget.check("matches", result.length + 1);
      result.push(this.#location(candidate) as Location<"image">);
    }
    return Object.freeze(result);
  }

  references(token: string): readonly StoryReference[] {
    const value = decodeLocation(token);
    this.#entry(value);
    this.#budget.charge("work", this.#index.references.length);
    const references = this.#index.references.filter(ref => ref.part === value.part);
    this.#budget.check("matches", references.length);
    return Object.freeze(references);
  }

  mutate(candidates: readonly Location[], selection: LocationMutationOptions, stage: LocationStage): LocationMutationResult {
    if (this.#inventory) throw new InvalidValueError("Read-only inventory locations cannot mutate the document.");
    if (this.#mutating) throw new InvalidValueError("A location mutation is already in progress.");
    closedRecord(selection, ["first", "all", "occurrence", "allowEmpty", "shared"]);
    if (selection.shared !== undefined && typeof selection.shared !== "boolean") throw new InvalidValueError("Expected a boolean shared switch.");
    const { shared, ...cardinality } = selection;
    const selected = this.select(candidates, cardinality, "mutation");
    if (!shared && selected.some(location => this.references(location.token).length > 1))
      throw new SelectionError("ambiguous-selection");
    if (typeof stage !== "function") throw new InputTypeError("Expected an engine staging callback.");
    if (!selected.length) return Object.freeze({ affected: 0, locations: [], changes: [] });
    if (this.#generation === Number.MAX_SAFE_INTEGER) throw new ResourceLimitError("Document generation limit exceeded.");
    this.#budget.charge("batchOperations", 1);
    this.#mutating = true;
    try {
      const editor = new DocumentArchiveEditor(this.#archive, {}, undefined, this.#budget);
      const updates = stage(editor, selected);
      if (!Array.isArray(updates)) throw new InvalidValueError("Staging must return synchronous location updates.");
      this.#budget.check("matches", updates.length);
      const beforeByToken = new Map(selected.map(location => [location.token, location]));
      const changed = new Set<string>();
      for (const update of updates) {
        closedRecord(update, ["before", "after"]);
        if (typeof update.before !== "string" || !beforeByToken.has(update.before) || changed.has(update.before))
          throw new InvalidValueError("Mutation updates must refer to distinct selected locations.");
        changed.add(update.before);
      }
      const candidate = editor.snapshot();
      let dirty = false;
      for (let i = 0; i < candidate.members.length; i++) {
        const before = this.#archive.members[i]!.bytes;
        const after = candidate.members[i]!.bytes;
        this.#budget.charge("work", Math.max(before.length, after.length));
        if (before.length !== after.length || before.some((byte, i) => byte !== after[i])) dirty = true;
      }
      if (!dirty) {
        if (updates.length) throw new InvalidValueError("An unchanged mutation cannot report changed locations.");
        return Object.freeze({ affected: 0, locations: [], changes: [] });
      }
      if (!updates.length) throw new InvalidValueError("Changed documents require location update receipts.");
      const next = new LocationIndex(candidate, this.#context.limits, this.#admission.mainPart, this.#admission.dialect, this.#budget);
      const previous = this.#index;
      this.#index = next;
      this.#generation++;
      try {
        const changes = updates.map(update => {
          const before = beforeByToken.get(update.before)!;
          let after: Location | null = null;
          if (update.after === null && before.value.range === null && next.byAddress.get(addressKey(before.value))?.some(entry => entry.kind === before.kind))
            throw new InvalidValueError("A surviving location cannot be reported as deleted.");
          if (update.after !== null) {
            const value = decodeLocation(encodeLocation({ ...update.after, version: 1, sourceSha256: this.#sourceSha256, generation: this.#generation }));
            after = this.#location(this.#entry(value, before.kind), value.range);
          }
          return Object.freeze({ before, after });
        });
        const locations = changes.flatMap(change => change.after ? [change.after] : []);
        const result = Object.freeze({ affected: changes.length, locations: Object.freeze(locations), changes: Object.freeze(changes) });
        this.#archive = candidate;
        return result;
      } catch (error) { this.#index = previous; this.#generation--; throw error; }
    } finally { this.#mutating = false; }
  }

  snapshot(): DocumentArchive {
    return this.#inventory ? this.#copyArchive(this.#archive) : new DocumentArchiveEditor(this.#archive, {}, undefined, this.#budget).snapshot();
  }

  #copyArchive(archive: DocumentArchive): DocumentArchive {
    const bytes = archive.comment.length + archive.members.reduce((total, member) => total + member.bytes.length, 0);
    this.#budget.charge("retainedBytes", bytes + archive.members.length * 96); this.#budget.charge("work", bytes + archive.members.length);
    return { comment: new Uint8Array(archive.comment), members: archive.members.map(member => ({ ...member, bytes: new Uint8Array(member.bytes), modified: new Date(member.modified.getTime()) })) };
  }
}

export type { DocumentLocations };
