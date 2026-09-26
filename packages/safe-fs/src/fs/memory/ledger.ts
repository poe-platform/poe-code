import { FsError } from "../../contracts/errors.js";
import type { MemoryFileSystemLimits } from "./limits.js";

const MAX_SMI = 1073741823;

export class MemoryLedger {
  private retainedBytes = 0;
  private metadataUnits = 0;
  readonly maxFileBytesSmi: number;
  readonly maxRetainedBytesSmi: number;
  readonly maxMetadataUnitsSmi: number;
  readonly hasInfiniteRetained: boolean;

  constructor(readonly limits: Readonly<MemoryFileSystemLimits>) {
    this.maxFileBytesSmi = limits.maxFileBytes >= MAX_SMI ? MAX_SMI : (limits.maxFileBytes | 0);
    this.maxRetainedBytesSmi = limits.maxRetainedBytes >= MAX_SMI ? MAX_SMI : (limits.maxRetainedBytes | 0);
    this.maxMetadataUnitsSmi = limits.maxMetadataUnits >= MAX_SMI ? MAX_SMI : (limits.maxMetadataUnits | 0);
    this.hasInfiniteRetained = limits.maxRetainedBytes === Infinity;
  }

  get availableBytes(): number {
    const max = this.limits.maxRetainedBytes;
    return max === Infinity ? Infinity : max - this.retainedBytes;
  }

  canPreallocate64(nameBytes: number): boolean {
    return this.maxFileBytesSmi >= 64 && (this.hasInfiniteRetained || this.maxRetainedBytesSmi - this.retainedBytes > 65536 + nameBytes);
  }

  fileSize(length: number, syscall: string, path: string): void {
    if ((length | 0) === length && length >= 0 && length <= this.maxFileBytesSmi) return;
    if (!Number.isSafeInteger(length) || length < 0 || length > this.limits.maxFileBytes) {
      throw new FsError("EFBIG", { syscall, path });
    }
  }

  check(bytes: number, units: number, syscall: string, path: string): void {
    if (
      (bytes | 0) === bytes && bytes >= 0 &&
      (units | 0) === units && units >= 0 &&
      this.retainedBytes <= this.maxRetainedBytesSmi - bytes &&
      this.metadataUnits <= this.maxMetadataUnitsSmi - units
    ) {
      return;
    }
    const maxRetained = this.limits.maxRetainedBytes;
    const maxUnits = this.limits.maxMetadataUnits;
    if (!Number.isSafeInteger(bytes) || bytes < 0 ||
      (maxRetained !== Infinity && bytes > maxRetained - this.retainedBytes) ||
      !Number.isSafeInteger(units) || units < 0 ||
      (maxUnits !== Infinity && units > maxUnits - this.metadataUnits)) {
      throw new FsError("ENOSPC", { syscall, path });
    }
  }

  reserve(bytes: number, units: number, syscall: string, path: string): void {
    if (
      (bytes | 0) === bytes && bytes >= 0 &&
      (units | 0) === units && units >= 0 &&
      this.retainedBytes <= this.maxRetainedBytesSmi - bytes &&
      this.metadataUnits <= this.maxMetadataUnitsSmi - units
    ) {
      this.retainedBytes = (this.retainedBytes + bytes) | 0;
      this.metadataUnits = (this.metadataUnits + units) | 0;
      return;
    }
    this.check(bytes, units, syscall, path);
    this.retainedBytes += bytes;
    this.metadataUnits += units;
  }

  release(bytes: number, units: number): void {
    if (bytes < 0 || units < 0 || bytes > this.retainedBytes || units > this.metadataUnits) {
      throw new Error("Invalid Memory filesystem reservation release");
    }
    this.retainedBytes -= bytes;
    this.metadataUnits -= units;
  }
}

export class MemoryAllocation {
  declare private references: number;
  declare readonly data: Uint8Array;
  declare private readonly ledger: MemoryLedger;

  constructor(data: Uint8Array, ledger: MemoryLedger) {
    this.data = data;
    this.ledger = ledger;
  }

  retain(): void {
    this.references++;
  }

  release(): void {
    if (this.references <= 0) throw new Error("Memory allocation already released");
    if (--this.references === 0) this.ledger.release(this.data.byteLength, 0);
  }

  isReleased64(): boolean {
    return this.references === 0 && this.data.byteLength === 64;
  }

  reuse(): void {
    this.references = 1;
    this.data.fill(0);
  }
}
Object.assign(MemoryAllocation.prototype, {
  references: 1,
});
