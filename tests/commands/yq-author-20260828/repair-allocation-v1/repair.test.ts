import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toByteSource, type ByteSink, type CommandContext } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createYqQuerySession, type YqOwnedWork } from "../../../../src/commands/structured/query-core.js";
import { JqLimitError, type Json } from "../../../../src/commands/structured/limits.js";
import { YqLedger, yqCaps } from "../../../../src/commands/yq/accounting.js";
import { encodeYaml } from "../../../../src/commands/yq/encoder.js";
import { createYqCommand } from "../../../../src/commands/yq/index.js";
import { parseYamlDocuments } from "../../../../src/commands/yq/parser.js";

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

const noopWork: YqOwnedWork = {
  async charge() {},
  admitInputBytes() {},
  admitOutputBytes() {},
  admitResult() {},
  async measure() { return 0; },
  async stringifyJson() { return ""; },
  reserve() { return { async beforeUnit() {}, finish() {}, abandon() {} }; },
  assertOpen() {},
};

async function parseOne(input: string): Promise<Json> {
  const values: Json[] = [];
  for await (const value of parseYamlDocuments(input, noopWork, new YqLedger())) values.push(value);
  assert.equal(values.length, 1);
  return values[0]!;
}

function sink(): ByteSink & { readonly chunks: Uint8Array[] } {
  const chunks: Uint8Array[] = [];
  return { chunks, async write(chunk) { chunks.push(new Uint8Array(chunk)); } };
}

async function run(input: string): Promise<{ status: number; stderr: string }> {
  const stdout = sink();
  const stderr = sink();
  const context: CommandContext = {
    command: "yq", args: [], stdin: toByteSource(input), stdout, stderr, cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
  const result = await createYqCommand().execute(context);
  return { status: result.exitCode, stderr: new TextDecoder().decode(Buffer.concat(stderr.chunks)) };
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

test("WRK-06 public raw document boundary counts CRLF bytes before normalization", async () => {
  const overByCr = `#${"x".repeat(yqCaps.maxDocumentBytes - 2)}\r\n`;
  assert.equal(Buffer.byteLength(overByCr), yqCaps.maxDocumentBytes + 1);
  const result = await run(overByCr);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /LIMIT_MAX_DOCUMENT_BYTES/u);

});

test("WRK-07 real parser accepts C and rejects C+1 decoded scalar bytes", async () => {
  const at = `"${"a".repeat(yqCaps.maxScalarBytes)}"`;
  assert.equal(await parseOne(at), "a".repeat(yqCaps.maxScalarBytes));
  const over = `"${"a".repeat(yqCaps.maxScalarBytes + 1)}"`;
  await assert.rejects(async () => parseOne(over), (failure: unknown) => {
    assert.equal((failure as { code?: string }).code, "LIMIT_MAX_SCALAR_BYTES");
    return true;
  });
});

test("WRK-17 actual encoders reserve exact escaped bytes before emitting fragments", async () => {
  await assert.rejects(() => encodeYaml("\0", noopWork, 7), (failure: unknown) => failure instanceof JqLimitError);
  assert.equal(await encodeYaml("\0", noopWork, 8), '"\\u0000"');
  const session = createYqQuerySession({ signal: new AbortController().signal });
  try {
    await assert.rejects(() => session.ownedWork.stringifyJson("\0", { pretty: false, maxBytes: 7, limitName: "maxOutputBytes" }), (failure: unknown) => failure instanceof JqLimitError);
    assert.equal(await session.ownedWork.stringifyJson("\0", { pretty: false, maxBytes: 8, limitName: "maxOutputBytes" }), '"\\u0000"');
  } finally {
    await session.close();
  }
});

test("WRK-13 actual parser admits the prospective second member before its child scalar", async () => {
  for (const [input, secondMemberChild] of [["[a,b]", 1], ["{a: one, b: two}", 2], ["- a\n- b\n", 1]] as const) {
    const events: string[] = [];
    const ledger = new class extends YqLedger {
      override admitScalar(bytes: number): void {
        events.push("scalar");
        super.admitScalar(bytes);
      }
      override admitValueBytes(bytes: number): void {
        events.push(`value:${bytes}`);
        super.admitValueBytes(bytes);
      }
    }();
    const work: YqOwnedWork = { ...noopWork, async charge() { events.push("charge"); } };
    for await (const unused of parseYamlDocuments(input, work, ledger)) void unused;
    const scalarEvents = events.flatMap((event, index) => event === "scalar" ? [index] : []);
    assert.equal(scalarEvents.length >= 2, true, JSON.stringify(events));
    const memberAdmission = events.indexOf("value:1");
    assert.notEqual(memberAdmission, -1, JSON.stringify(events));
    assert.ok(memberAdmission < scalarEvents[secondMemberChild]!, JSON.stringify(events));
  }
});
