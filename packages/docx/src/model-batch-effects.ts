import type { DocumentArchive } from "./archive.js";
import type { DocumentBudget } from "./budget.js";
import { encodeLocation, type Location } from "./location-token.js";
import { normalizePartName } from "./part-uri.js";

export interface ModelBatchItemResult {
  readonly id?: never;
  readonly version: 1;
  readonly operation: string;
  readonly ok: true;
  readonly data: unknown;
  readonly affected: number;
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly errors: readonly never[];
  readonly locations: readonly Location[];
}
export interface ModelBatchChange {
  readonly kind: "add" | "set" | "remove";
  readonly before: Location | null;
  readonly after: Location | null;
}

/** Tracks actual staged package changes, independently of setter/revision counts. */
export class ModelBatchEffects {
  private generation = 0;
  readonly changes: ModelBatchChange[] = [];
  constructor(private previous: DocumentArchive, private readonly sourceSha256: string, private readonly budget: DocumentBudget) {}

  record(next: DocumentArchive): readonly ModelBatchChange[] {
    const before = new Map(this.previous.members.filter(member => !member.directory).map(member => [member.name, member.bytes]));
    const after = new Map(next.members.filter(member => !member.directory).map(member => [member.name, member.bytes]));
    const changed: string[] = [];
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(name), b = after.get(name);
      this.budget.charge("work", (a?.length ?? 0) + (b?.length ?? 0) + 1);
      if (!a || !b || a.length !== b.length || !a.every((byte, index) => byte === b[index])) changed.push(name);
    }
    const locate = (name: string, generation: number): Location => {
      const part = name.toLowerCase() === "[content_types].xml" ? "/[Content_Types].xml" : normalizePartName("/" + name);
      const value = { version: 1 as const, sourceSha256: this.sourceSha256, generation, part, story: "package", path: [], range: null };
      const token = encodeLocation(value);
      this.budget.charge("retainedBytes", token.length * 4 + 256);
      return {kind: "part", token, value, positions: {}};
    };
    const changes = changed.map(name => ({
      kind: !before.has(name) ? "add" as const : !after.has(name) ? "remove" as const : "set" as const,
      before: before.has(name) ? locate(name, this.generation) : null,
      after: after.has(name) ? locate(name, this.generation + 1) : null
    }));
    if (changes.length) this.generation++;
    this.previous = next;
    this.changes.push(...changes);
    return changes;
  }
}
