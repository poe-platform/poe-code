import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { TargetDocuments } from "./stored-target.js";
import type { ReplayOutcome, ReplayPatch } from "./stored-patch.js";

/** Invocation-wide storage for application, reversal-probe and merge outcomes. */
export class OutcomeStore {
  private readonly records: PagedStorage;
  constructor(documents: TargetDocuments) {
    this.records = new PagedStorage(documents.budget.context, 16, documents.cache);
  }
  create(patch: ReplayPatch): StoredOutcomes {
    return new StoredOutcomes(this.records, this.records.allocate(patch.hunks.length * 64), patch);
  }
  close(): Promise<void> { return this.records.close(); }
}

export class StoredOutcomes {
  length = 0;
  constructor(private readonly records: PagedStorage, private readonly start: number, private readonly patch: ReplayPatch) {}

  async push(outcome: ReplayOutcome): Promise<void> {
    if (this.length >= this.patch.hunks.length) throw new RangeError("Too many patch outcomes");
    const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
    view.setFloat64(0, outcome.index, true); view.setFloat64(8, outcome.line, true);
    view.setFloat64(16, outcome.outputOffset, true); view.setFloat64(24, outcome.offset, true);
    view.setFloat64(32, outcome.fuzz, true); view.setFloat64(40, outcome.mergeRange?.[0] ?? NaN, true);
    view.setFloat64(48, outcome.mergeRange?.[1] ?? NaN, true);
    bytes[56] = (outcome.failed ? 1 : 0) | (outcome.misordered ? 2 : 0);
    await this.records.write(this.start + this.length * 64, bytes);
    this.length++;
  }

  async at(position: number): Promise<ReplayOutcome | undefined> {
    if (!Number.isSafeInteger(position) || position < 0 || position >= this.length) return undefined;
    const bytes = await this.records.read(this.start + position * 64, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const index = view.getFloat64(0, true), mergeStart = view.getFloat64(40, true);
    return { hunk: this.patch.hunks[index - 1]!, index, line: view.getFloat64(8, true),
      outputOffset: view.getFloat64(16, true), offset: view.getFloat64(24, true), fuzz: view.getFloat64(32, true),
      failed: !!(bytes[56]! & 1), misordered: !!(bytes[56]! & 2),
      ...(Number.isNaN(mergeStart) ? {} : { mergeRange: [mergeStart, view.getFloat64(48, true)] as const }),
    };
  }

  async pop(): Promise<ReplayOutcome | undefined> {
    const outcome = await this.at(this.length - 1);
    if (outcome) this.length--;
    return outcome;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<ReplayOutcome> {
    for (let index = 0; index < this.length; index++) yield (await this.at(index))!;
  }
}
