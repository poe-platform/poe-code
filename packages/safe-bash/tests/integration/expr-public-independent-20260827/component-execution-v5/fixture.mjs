import assert from "node:assert/strict";
import { join } from "node:path";
import { legacyDirectory, read, digest } from "./common.mjs";

export const casesPath = join(legacyDirectory, "cases.json");
export const casesSha256 = "215f5e8f44ccf8792cfc175437fe9701fa7f176d29081d5d561cd828f1269b16";
export function frozenCases(filename = casesPath) {
  const bytes = read(filename);
  assert.equal(digest(bytes), casesSha256, "EXPR_CASES_HASH");
  return JSON.parse(bytes);
}
