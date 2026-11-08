import type { BytesResult } from "./harness.js";

export interface SourceSnapshot {
  productSha256: string;
  structuredSha256: string;
  files: Record<string, string>;
  head: string;
  status: string;
  tooling: Record<string, string>;
}
export const directory: string;
export const root: string;
export const auditCommit: string;
export const auditPath: string;
export const handoffPath: string;
export const cohortFiles: { path: string; cohort: string; count: number }[];
export function digest(bytes: string | Uint8Array): string;
export function bytesResult(result: BytesResult): BytesResult;
export function git(args: string[]): Buffer;
export function frozenFile(path: string): Buffer;
export function addArtifact(name: string, document: unknown): string;
export function sourceSnapshot(): SourceSnapshot;
