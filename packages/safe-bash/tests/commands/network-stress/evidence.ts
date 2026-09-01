import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Observation } from "./native.js";

export const oracleSha256 = "b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7";
export interface Evidence {
  schema: number;
  capturedAt: string;
  handoffObserved: boolean;
  productRuns: number;
  sourceHashes: Record<string, string>;
  counts: Record<string, number>;
  contractRows: string[];
  observations: Observation[];
}

export async function loadEvidence(): Promise<Evidence> {
  const bytes = await readFile(new URL("./oracle.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), oracleSha256, "Frozen oracle changed; no automatic refresh permitted");
  const evidence = JSON.parse(bytes.toString()) as Evidence;
  assert.equal(evidence.schema, 1);
  return evidence;
}
