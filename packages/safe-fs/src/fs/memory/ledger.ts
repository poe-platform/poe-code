import { FsError } from "../../contracts/errors.js";
import type { MemoryFileSystemLimits } from "./limits.js";

export class MemoryLedger {
  private retainedBytes = 0;
  private metadataUnits = 0;

  constructor(readonly limits: Readonly<MemoryFileSystemLimits>) {}

  get availableBytes(): number {
    return this.limits.maxRetainedBytes - this.retainedBytes;
  }

  fileSize(length: number, syscall: string, path: string): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.limits.maxFileBytes) {
      throw new FsError("EFBIG", { syscall, path });
    }
  }

  check(bytes: number, units: number, syscall: string, path: string): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.availableBytes ||
      !Number.isSafeInteger(units) || units < 0 || units > this.limits.maxMetadataUnits - this.metadataUnits) {
      throw new FsError("ENOSPC", { syscall, path });
    }
  }

  reserve(bytes: number, units: number, syscall: string, path: string): void {
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
  private references = 1;

  constructor(readonly data: Uint8Array, private readonly ledger: MemoryLedger) {}

  retain(): void {
    this.references++;
  }

  release(): void {
    if (this.references <= 0) throw new Error("Memory allocation already released");
    if (--this.references === 0) this.ledger.release(this.data.byteLength, 0);
  }
}
