import type { Vector } from "./harness.js";

export const manifestSha256: string;
export function loadEvidence(): {
  manifest: { original42: { classification: string; auditName: string; id: string; cohort: string }[] };
  historical: Vector[];
  independent: Vector[];
  vectors: Vector[];
  original: Set<string>;
};
export function transports(vector: Vector): string[];
