export interface ArchiveReadSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Caller-owned immutable storage; finish seals appends and retains bounded reads. */
export interface ArchiveMetadataSpool {
  append(bytes: Uint8Array): Promise<void>;
  finish(): Promise<ArchiveReadSource>;
  close(): Promise<void>;
}
export type ArchiveMetadataFactory = () => Promise<ArchiveMetadataSpool>;
