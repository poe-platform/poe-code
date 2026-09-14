import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeQuotedPrintable, encodeQuotedPrintable} from "./quoted-printable.js";
import reference from "./__snapshots__/codec-quoted-printable-mixed.json";

let state = reference.seed;
const random = () => state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
const alphabet = [0, 9, 10, 13, 32, 46, 61, 65, 70, 95, 126, 255];
const rows = Array.from({length: reference.count}, () => ({
  bytes: Array.from({length: (random() >>> 8) % 200}, () => alphabet[(random() >>> 8) % alphabet.length]),
  flags: (random() >>> 8) % 8
}));

it("retains the complete mixed quoted-printable corpus and pinned reference", () => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(rows).toHaveLength(30000);
  expect(new Set(rows.map(row => row.flags))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  expect(reference.blocks.map(({offset, count}) => [offset, count])).toEqual(
    Array.from({length: 200}, (_, index) => [index * 150, 150])
  );
  expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe(reference.inputSha256);
});

// Ordered hashes retain exact output bytes, including mixed newline conventions,
// soft wrapping and malformed escapes. Every oracle row runs in memory through
// the metered kernels; host Python is used only by the retained external driver.
it.each(reference.blocks)("matches mixed quoted-printable rows $offset + $count", ({offset, count, sha256}) => {
  const actual = rows.slice(offset, offset + count).map(({bytes, flags}) => {
    const input = Uint8Array.from(bytes);
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
    return [
      [...encodeQuotedPrintable(input, {quoteTabs: !!(flags & 1), isText: !!(flags & 2), header: !!(flags & 4)}, meter)],
      [...decodeQuotedPrintable(input, !!(flags & 4), meter)]
    ];
  });
  expect(createHash("sha256").update(JSON.stringify(actual)).digest("hex")).toBe(sha256);
});
