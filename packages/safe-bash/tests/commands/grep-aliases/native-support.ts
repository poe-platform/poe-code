
import { createHash } from "node:crypto";
export const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export interface Observation { readonly code: number; readonly stdoutBase64: string; readonly stderrBase64: string }
export interface NativeProfile {
  readonly profile: string;
  readonly platform: string;
  readonly architecture: string;
  readonly corpusSha256: string;
  readonly environment: Record<string, string>;
  readonly identities: Record<string, { path: string; sha256: string; version: Observation }>;
  readonly observations: readonly { id: string; result: Observation }[];
  readonly cleanup: { childrenReaped: true; temporaryRemoved: true; timeouts: number; temporary: string };
}
