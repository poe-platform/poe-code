import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTomlDocument } from "../../src/commands/yq/toml.js";
import { YqLedger } from "../../src/commands/yq/accounting.js";
import { createYqQuerySession } from "../../src/commands/structured/query-core.js";

async function parse(source: string, signal = new AbortController().signal) {
  const session = createYqQuerySession({ signal });
  try {
    const value = await parseTomlDocument(source, session.ownedWork, new YqLedger(), Buffer.byteLength(source));
    return JSON.parse(await session.ownedWork.stringifyJson(value, { pretty: false, maxBytes: 8388608, limitName: "maxValueBytes" }));
  } finally { await session.close(); }
}

for (const [source, expected] of [
  ["", {}],
  ['a.b=1\na.c=2\n[a.d]\ne=true', { a: { b: 1, c: 2, d: { e: true } } }],
  ['[a.b]\nx=1\n[a]\ny=2', { a: { b: { x: 1 }, y: 2 } }],
  ['[[a]]\nx=1\n[a.b]\nz=2\n[[a]]\nx=3', { a: [{ x: 1, b: { z: 2 } }, { x: 3 }] }],
  ['a=[1, "two", {x=true}, [3],]\nb={ x.y=1, x.z=2 }', { a: [1, "two", { x: true }, [3]], b: { x: { y: 1, z: 2 } } }],
  ['a="""\nhello\\  \n  world"""\nb=\'literal\\path\'', { a: "helloworld", b: "literal\\path" }],
  ['a=0b101\nb=0xFF\nc=-1_000\nd=1.25e2', { a: 5, b: 255, c: -1000, d: 125 }],
  ['a=1979-05-27 07:32:00.123456789Z\nb=07:32:00', { a: "1979-05-27 07:32:00.123456789Z", b: "07:32:00" }],
  ['__proto__.x=1\nconstructor=2', { ["__proto__"]: { x: 1 }, constructor: 2 }],
] as const) test(`bounded TOML parser accepts ${source.slice(0, 40)}`, async () => {
  assert.deepEqual<unknown>(await parse(source), expected);
});

for (const source of [
  'a=1\na=2', 'a.b=1\n[a]', '[a]\n[a]', 'a={b=1}\na.c=2', 'a=[]\n[[a]]',
  'a={b=1,}', 'a={\nb=1}', 'a=01', 'a=1__2', 'a=0x_FF', 'a=+0x1',
  'a="\\x41"', 'a="\\uD800"', 'a="line\nbreak"', 'a=2023-02-29', 'a=24:00:00',
  '\ufeffa=1', 'a=1\rb=2', '# bad\u007f', 'a=true trailing', 'a=null',
]) test(`bounded TOML parser refuses ${JSON.stringify(source)}`, async () => {
  await assert.rejects(parse(source), { status: 5 });
});

for (const source of ['a=9007199254740992', 'a=inf', 'a=nan', 'a=1e9999']) test(`bounded TOML numeric profile refuses ${source}`, async () => {
  await assert.rejects(parse(source), { status: 5 });
});

test("dotted paths count toward parse-time depth admission", async () => {
  await assert.rejects(parse('a.'.repeat(129) + 'x=1'), { code: "LIMIT_MAX_DEPTH" });
});

test("long token cancellation preserves the caller reason", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: true });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(parse('a="' + 'x'.repeat(500000) + '"', controller.signal), error => error === reason); }
  finally { clearTimeout(timer); }
});

test("dotted assignment promotes an implicit table before later header admission", async () => {
  const prefix = '[a.b.c]\nx=1\n[a]\nb.d=2';
  assert.deepEqual(await parse(prefix), { a: { b: { c: { x: 1 }, d: 2 } } });
  assert.deepEqual(await parse('[a.b.c]\nx=1\n[a.b]\ne=3'), { a: { b: { c: { x: 1 }, e: 3 } } });
  await assert.rejects(parse(prefix + '\n[a.b]\ne=3'), { code: "SCHEMA_DUPLICATE_KEY" });
});
