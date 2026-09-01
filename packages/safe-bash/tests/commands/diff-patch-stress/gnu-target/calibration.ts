import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface Capture {
  binary: string;
  args: string[];
  input: string;
  before: Record<string, string>;
  exitCode: number | null;
  signal: string | null;
  bounded: string | null;
  stdout: string;
  stderr: string;
  after: Record<string, unknown>;
}

interface Evidence {
  formats: { name: string; flow: { name: string; old: string; next: string }; gnuDiff: Capture; directions: { reverse: boolean; gnu: Capture; apple: Capture }[] }[];
  parser: { id: string; fixture?: { before: string; patch: string }; generated: Capture | null; gnu: Capture }[];
}

const bytes = readFileSync(new URL("./calibration-2026-08-26.json", import.meta.url));
export const calibrationSha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(calibrationSha256, "f10b84f6000f7c68eaae12fc726c828b913c97cc5c0e49d5108bee1a49774c28", "independent native evidence changed; review a new capture instead");
export const calibration = JSON.parse(bytes.toString()) as Evidence;
