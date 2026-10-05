import { PagedStorage } from "@poe-code/safe-fs/storage";
import { closeDocumentResources } from "safe-bash-diff-engine/document";
import { targetBytes, type TargetDocuments, type TargetLine } from "./stored-target.js";
import type { FilePatch, Hunk, HunkApplication, HunkLineBuilder, HunkOutcome, PatchLine } from "./unified.js";

export interface StoredPatchLine { readonly kind: PatchLine["kind"]; readonly text: TargetLine }
export interface StoredPatchLines { readonly length: number; read(index: number): Promise<StoredPatchLine> }
export type PatchLines = PatchLine[] | StoredPatchLines;
export type ReplayPatch = FilePatch<PatchLines>;
export type ReplayOutcome = HunkOutcome<PatchLines>;
export type ReplayApplication = HunkApplication<PatchLines>;

export async function patchLine(hunk: Hunk<PatchLines>, index: number): Promise<StoredPatchLine> {
  return Array.isArray(hunk.lines) ? hunk.lines[index]! : hunk.lines.read(index);
}

/** Hunk payloads and fixed-width records share the invocation's caller-backed cache. */
export class PatchBodyStore {
  private readonly data: PagedStorage;
  private readonly records: PagedStorage;
  private dataEnd = 8;
  private recordEnd = 8;
  constructor(documents: TargetDocuments) {
    this.data = new PagedStorage(documents.budget.context, 16, documents.cache);
    this.records = new PagedStorage(documents.budget.context, 16, documents.cache);
  }

  begin(): HunkLineBuilder<StoredPatchLines> {
    const start = this.recordEnd;
    let length = 0;
    return {
      lines: {
        get length() { return length; },
        read: async index => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= length) throw new RangeError("Invalid patch line");
          const bytes = await this.records.read(start + index * 24, 24);
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return { kind: String.fromCharCode(bytes[16]!) as PatchLine["kind"],
            text: { storage: this.data, start: view.getFloat64(0, true), end: view.getFloat64(8, true) } };
        },
      },
      append: async line => {
        const textStart = this.dataEnd;
        for await (const bytes of targetBytes(line.text)) { await this.data.append(bytes); this.dataEnd += bytes.length; }
        const cell = new Uint8Array(24), view = new DataView(cell.buffer);
        view.setFloat64(0, textStart, true); view.setFloat64(8, this.dataEnd, true); cell[16] = line.kind.charCodeAt(0);
        await this.records.append(cell); this.recordEnd += 24; length++;
      },
    };
  }

  close(): Promise<void> { return closeDocumentResources([this.data, this.records]); }
}

export function reverseStoredPatch(patch: ReplayPatch): ReplayPatch {
  return { ...patch, oldPath: patch.newPath, newPath: patch.oldPath, oldEpoch: patch.newEpoch, newEpoch: patch.oldEpoch,
    hunks: patch.hunks.map(hunk => ({ ...hunk, oldStart: hunk.newStart, oldCount: hunk.newCount,
      newStart: hunk.oldStart, newCount: hunk.oldCount, lines: {
        length: hunk.lines.length,
        async read(index) {
          const line = await patchLine(hunk, index);
          return { kind: line.kind === "+" ? "-" : line.kind === "-" ? "+" : " ", text: line.text };
        },
      } })),
  };
}
