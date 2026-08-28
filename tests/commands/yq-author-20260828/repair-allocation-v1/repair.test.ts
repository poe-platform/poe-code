import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

function ordered(body: string, before: string, after: string): void {
  const admission = body.indexOf(before);
  const allocation = body.indexOf(after);
  assert.notEqual(admission, -1, `missing admission marker: ${before}`);
  assert.notEqual(allocation, -1, `missing allocation marker: ${after}`);
  assert.ok(admission < allocation, `${before} must precede ${after}`);

  const mutant = body.replace(before, "__SWAP__").replace(after, before).replace("__SWAP__", after);
  assert.throws(() => orderedWithoutMutant(mutant, before, after), /must precede/u);
}

function orderedWithoutMutant(body: string, before: string, after: string): void {
  const admission = body.indexOf(before);
  const allocation = body.indexOf(after);
  assert.ok(admission >= 0 && allocation >= 0 && admission < allocation, `${before} must precede ${after}`);
}

test("WRK-06 raw document admission precedes retained copy and decode", async () => {
  const text = await source("src/commands/yq/index.ts");
  ordered(text, "framer.admit(chunk)", "new Uint8Array(chunk)");
  ordered(text, "frame.rawBytes", "decodeDocument(frame.bytes)");
});

test("WRK-07 scalar projection/admission precedes scalar construction", async () => {
  const text = await source("src/commands/yq/parser.ts");
  ordered(text, "this.composer.admitScalar(projectedBytes)", "decodeDouble(raw)");
  ordered(text, "this.composer.admitScalar(projectedBytes)", "decodeSingle(raw)");
  ordered(text, "this.composer.admitScalar(projectedBytes)", "buildBlockScalar(values, style, chomping)");
});

test("WRK-13 prospective collection member admission precedes child parsing", async () => {
  const text = await source("src/commands/yq/parser.ts");
  ordered(text, "this.composer.member(result.length + 1)", "let value = await this.#node()" );
  ordered(text, "this.composer.member(result.length + 1)", "item = next && indentation(next.text) > indent");
});

test("WRK-17 escaped-fragment byte admission precedes escaped construction", async () => {
  const yaml = await source("src/commands/yq/encoder.ts");
  const json = await source("src/commands/structured/query-core.ts");
  ordered(yaml, "output.reserve(projectedBytes)", "fragment += yamlEscape");
  ordered(json, "reserveFragment(projectedBytes)", "fragment += jsonEscape");
});

test("fixed public caps remain literal and are not replaced by proof thresholds", async () => {
  const accounting = await source("src/commands/yq/accounting.ts");
  const query = await source("src/commands/structured/query-core.ts");
  assert.match(accounting, /maxDocumentBytes:\s*8_388_608/u);
  assert.match(accounting, /maxScalarBytes:\s*1_048_576/u);
  assert.match(accounting, /maxCollectionSize:\s*100_000/u);
  assert.match(accounting, /maxOutputBytes:\s*16_777_216/u);
  assert.match(query, /maxCollectionSize:\s*100_000/u);
  assert.match(query, /maxOutputBytes:\s*16_777_216/u);
});
