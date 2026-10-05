import { PagedStorage } from "@poe-code/safe-fs/storage";
import { closeDocumentResources } from "safe-bash-diff-engine/document";
import { targetBytes, type TargetDocuments, type TargetLine } from "./stored-target.js";
import type { FilePatch, Hunk, HunkApplication, HunkBuilder, HunkLineBuilder, HunkOutcome, PatchLine } from "./unified.js";

export interface StoredPatchLine { readonly kind: PatchLine["kind"]; readonly text: TargetLine }
export interface StoredPatchLines { readonly length: number; read(index: number): Promise<StoredPatchLine> }
export type PatchLines = PatchLine[] | StoredPatchLines;
export interface StoredPatchHunks { readonly length: number; read(index: number): Promise<Hunk<PatchLines>> }
export type ReplayPatch = FilePatch<PatchLines, Hunk<PatchLines>[] | StoredPatchHunks>;
export type ReplayOutcome = HunkOutcome<PatchLines>;
export interface OutcomeSink {
  push(outcome: ReplayOutcome): number | Promise<void>;
  pop(): ReplayOutcome | undefined | Promise<ReplayOutcome | undefined>;
}
export type ReplayApplication = Omit<HunkApplication<PatchLines>, "outcomes"> & { readonly outcomes?: OutcomeSink };

export async function patchLine(hunk: Hunk<PatchLines>, index: number): Promise<StoredPatchLine> {
  return Array.isArray(hunk.lines) ? hunk.lines[index]! : hunk.lines.read(index);
}

export async function patchHunk(patch: ReplayPatch, index: number): Promise<Hunk<PatchLines>> {
  return Array.isArray(patch.hunks) ? patch.hunks[index]! : patch.hunks.read(index);
}

export async function* patchHunks(patch: ReplayPatch): AsyncGenerator<readonly [number, Hunk<PatchLines>]> {
  for (let index = 0; index < patch.hunks.length; index++) yield [index, await patchHunk(patch, index)];
}

class BodyLines implements StoredPatchLines {
  length = 0;
  constructor(readonly start: number, private readonly records: PagedStorage, private readonly data: PagedStorage) {}
  async read(index: number): Promise<StoredPatchLine> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new RangeError("Invalid patch line");
    const bytes = await this.records.read(this.start + index * 24, 24);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { kind: String.fromCharCode(bytes[16]!) as PatchLine["kind"],
      text: { storage: this.data, start: view.getFloat64(0, true), end: view.getFloat64(8, true) } };
  }
}

/** Hunk payloads and fixed-width records share the invocation's caller-backed cache. */
export class PatchBodyStore {
  private readonly data: PagedStorage;
  private readonly records: PagedStorage;
  private readonly hunks: PagedStorage;
  private dataEnd = 8;
  private recordEnd = 8;
  private hunkEnd = 8;
  constructor(documents: TargetDocuments) {
    this.data = new PagedStorage(documents.budget.context, 16, documents.cache);
    this.records = new PagedStorage(documents.budget.context, 16, documents.cache);
    this.hunks = new PagedStorage(documents.budget.context, 16, documents.cache);
  }

  begin(): HunkLineBuilder<BodyLines> {
    const lines = new BodyLines(this.recordEnd, this.records, this.data);
    return {
      lines,
      append: async line => {
        const textStart = this.dataEnd;
        for await (const bytes of targetBytes(line.text)) { await this.data.append(bytes); this.dataEnd += bytes.length; }
        const cell = new Uint8Array(24), view = new DataView(cell.buffer);
        view.setFloat64(0, textStart, true); view.setFloat64(8, this.dataEnd, true); cell[16] = line.kind.charCodeAt(0);
        await this.records.append(cell); this.recordEnd += 24; lines.length++;
      },
    };
  }

  beginHunks(): HunkBuilder<BodyLines, StoredPatchHunks> {
    const start = this.hunkEnd;
    let length = 0;
    return {
      hunks: {
        get length() { return length; },
        read: async index => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= length) throw new RangeError("Invalid patch hunk");
          const bytes = await this.hunks.read(start + index * 64, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const lines = new BodyLines(view.getFloat64(32, true), this.records, this.data);
          lines.length = view.getFloat64(40, true);
          const decoder = new TextDecoder();
          let section = "";
          for (let position = view.getFloat64(48, true), end = view.getFloat64(56, true); position < end;) {
            const part = await this.data.read(position, Math.min(16384, end - position));
            section += decoder.decode(part, { stream: true }); position += part.length;
          }
          section += decoder.decode();
          return { oldStart: view.getFloat64(0, true), oldCount: view.getFloat64(8, true),
            newStart: view.getFloat64(16, true), newCount: view.getFloat64(24, true), lines, section };
        },
      },
      append: async hunk => {
        const sectionStart = this.dataEnd;
        for await (const bytes of targetBytes(hunk.section ?? "")) { await this.data.append(bytes); this.dataEnd += bytes.length; }
        const cell = new Uint8Array(64), view = new DataView(cell.buffer);
        for (const [index, value] of [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount,
          hunk.lines.start, hunk.lines.length, sectionStart, this.dataEnd].entries()) view.setFloat64(index * 8, value, true);
        await this.hunks.append(cell); this.hunkEnd += 64; length++;
      },
    };
  }

  close(): Promise<void> { return closeDocumentResources([this.data, this.records, this.hunks]); }
}

export function reverseStoredPatch(patch: ReplayPatch): ReplayPatch {
  return { ...patch, oldPath: patch.newPath, newPath: patch.oldPath, oldEpoch: patch.newEpoch, newEpoch: patch.oldEpoch,
    hunks: { length: patch.hunks.length, async read(index) {
      const hunk = await patchHunk(patch, index);
      return { ...hunk, oldStart: hunk.newStart, oldCount: hunk.newCount,
      newStart: hunk.oldStart, newCount: hunk.oldCount, lines: {
        length: hunk.lines.length,
        async read(index) {
          const line = await patchLine(hunk, index);
          return { kind: line.kind === "+" ? "-" : line.kind === "-" ? "+" : " ", text: line.text };
        },
      } };
    } },
  };
}
