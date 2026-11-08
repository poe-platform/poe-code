import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYamlDocuments } from "./parser.js";
import { YqLedger, resolveYqLimits, type YqLimits } from "./accounting.js";
import { createYqQuerySession } from "safe-bash-query-engine/query-core";

async function parse(source: string, limits: Partial<YqLimits> = {}, lineOffset = 0) {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  try {
    const values = [];
    for await (const value of parseYamlDocuments(source, session.ownedWork, new YqLedger(resolveYqLimits(limits)), undefined, lineOffset)) values.push(value);
    return values;
  } finally { await session.close(); }
}

test("YAML source lines above the former ceiling are unlimited", async () => {
  assert.deepEqual(await parse("\n".repeat(65536) + "true\n"), [true]);
});

test("source line limits are configurable and include comments and document boundaries", async () => {
  assert.deepEqual(await parse("#\ntrue\n", { maxSourceLines: 2 }), [true]);
  await assert.rejects(parse("#\ntrue\n", { maxSourceLines: 1 }), { code: "LIMIT_MAX_SOURCE_LINES" });
  await assert.rejects(parse("true\n---\nfalse\n", { maxSourceLines: 2 }), { code: "LIMIT_MAX_SOURCE_LINES" });
});

test("YAML line accounting works without the Node Buffer global", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
  try { assert.deepEqual(await parse("# é\ntrue\n"), [true]); }
  finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
});

test("framed YAML input cannot reset the source line limit", async () => {
  await assert.rejects(parse("true\n", { maxSourceLines: 2 }, 2), { code: "LIMIT_MAX_SOURCE_LINES" });
  assert.deepEqual(await parse("true\n", { maxSourceLines: 3 }, 2), [true]);
});
