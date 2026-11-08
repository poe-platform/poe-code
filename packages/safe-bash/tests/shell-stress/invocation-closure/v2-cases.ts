import assert from "node:assert/strict";
import { cases as originalCases, hostCases } from "./cases.js";
export { hostCases };

const replacements = {
  "query-V-verbose": [["command -V printf closurefn closuretool", "command -V true closurefn closuretool"]],
  "type-multiple-status": [["type -t printf closurefn closuretool closure_missing", "type -t true closurefn closuretool closure_missing"], ["type printf closuretool", "type true closuretool"]],
} satisfies Record<string, string[][]>;

export const cases = originalCases.map(row => {
  const changes = replacements[row.id as keyof typeof replacements];
  if (!changes) return row;
  let source = row.source;
  for (const [before, after] of changes) {
    assert.ok(before && after); assert.equal(source.split(before).length, 2);
    source = source.replace(before, after);
  }
  return { ...row, source };
});
export const adaptations = cases.flatMap((row, index) => row.source === originalCases[index]!.source ? [] : [{ id: row.id, before: originalCases[index]!.source, after: row.source }]);
assert.equal(cases.length, 26); assert.equal(hostCases.length, 8); assert.equal(adaptations.length, 2);
for (const [index, row] of cases.entries()) assert.deepEqual({ ...row, source: originalCases[index]!.source }, originalCases[index]);
assert.ok(cases.find(row => row.id === "type-multiple-status")!.source.includes('printf "mixed:%s\\n" "$?"'));
