import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { digest, type Vector } from "./harness.js";

export const additiveEvidence = [
  ["phase2-vectors.json", "afcfae94201a04a4455e7410371bfbdcfbe35823939569cc13786779dfaca101"],
  ["phase2-extra-vectors.json", "230ac4fa5531e104b541b1e65f177c27c5efc9267125977a112df54dc7e743ac"],
  ["exponent-vectors.json", "e90ececb9f163080873975c46063245df6200b7316edd682a401e33c07f9039d"],
  ["overflow-comparison-vectors.json", "86808210a4d14d5c5e5ad86db2a0803875e6143047a3f8dbf256378635891789"],
] as const;
export const additiveVectors = additiveEvidence.flatMap(([name, hash]) => {
  const bytes = readFileSync(new URL(name, import.meta.url));
  assert.equal(digest(bytes), hash, name);
  return (JSON.parse(bytes.toString()) as { cases: Vector[] }).cases;
});
export const authorProbeMistakes = new Set(["compare-mixed-double", "scalar-types", "preserve-through-copy", "conversion-large-token"]);
