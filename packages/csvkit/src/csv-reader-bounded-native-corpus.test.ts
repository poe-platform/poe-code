import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { readCsv, readCsvStream, type CsvRecord } from "./csv.js";

// Frozen CPython 3.14.2 csv.reader, universal newlines, backslash escaping.
// Native capture identity and corpus order: docs/csvkit/current-user-edge-validation.md.
test("bounded native CSV corpus preserves cells and physical line numbers in both readers", async () => {
  const alphabet = ["a", ",", '"', "\\", "\n", "\r"];
  let layer = [""];
  const inputs = [...layer];
  for (let length = 1; length <= 5; length++) {
    layer = layer.flatMap(prefix => alphabet.map(char => prefix + char));
    inputs.push(...layer);
  }
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(inputs.length, 9331);
  assert.equal(hash(inputs), "ec9e3ebb8f308422ac2e7caf8dd825e0a49d7fc0ccd0333ec002979948a940be");
  const direct: CsvRecord[][] = [];
  const streamed: CsvRecord[][] = [];
  for (const input of inputs) {
    direct.push([...readCsv(input, { escapechar: "\\" })]);
    const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const lines = normalized.split("\n").map((line, index, array) => index < array.length - 1 ? line + "\n" : line);
    if (lines.at(-1) === "") lines.pop();
    const rows: CsvRecord[] = [];
    for await (const row of readCsvStream((async function* () { yield* lines; })(), { escapechar: "\\" })) rows.push(row);
    assert.deepEqual(rows, direct.at(-1), `physical-line streaming input ${JSON.stringify(input)}`);
    streamed.push(rows);
  }
  const nativeRecords = "efdeb5f0f00c95f7f699a92167988280e90105457b280203343236b413bfec9e";
  assert.equal(hash(direct), nativeRecords);
  assert.equal(hash(streamed), nativeRecords);
});
