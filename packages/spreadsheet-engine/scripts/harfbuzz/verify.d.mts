export function verifyArtifact(input: {
  source: string;
  manifest: unknown;
  files: ReadonlyMap<string, Uint8Array>;
}): {
  byteLength: number;
  initialMemoryBytes: number;
  maximumMemoryBytes: number;
  sha256: string;
};
