import { CsvBudget } from "safe-bash-csv-engine";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { cutCsv, type CsvcutOptions, type CsvcutRunOptions } from "./behavior.js";

const encoder = new TextEncoder();
async function run(input: string, options: CsvcutOptions = {}, configuration: Partial<CsvcutRunOptions> = {}) {
  const chunks: Uint8Array[] = [];
  const source = async function* () { yield encoder.encode(input); };
  for await (const bytes of cutCsv(source, options, { signal: new AbortController().signal, ...configuration })) chunks.push(bytes);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.concat(chunks));
}
const a = "id,name,note\n1,A,x\n2,B,y\n";
const cases: readonly [string, string, CsvcutOptions, string][] = [
  ["S01", a, {}, a],
  ["S02", a, { include: "3,1,3" }, "note,id,note\nx,1,x\ny,2,y\n"],
  ["S03", a, { include: "name,id" }, "name,id\nA,1\nB,2\n"],
  ["S04-S06", "id,id,3,x-y,x:y\na,b,c,d,e\n", { include: "id,3,x-y,x:y,id" }, "id,3,x-y,x:y,id\na,c,d,e,a\n"],
  ["S07", a, { include: "1:2,1-2" }, "id,name,id,name\n1,A,1,A\n2,B,2,B\n"],
  ["S08", a, { include: "-2,:2" }, "id,name,id,name\n1,A,1,A\n2,B,2,B\n"],
  ["S09", a, { include: "2-" }, "name,note\nA,x\nB,y\n"],
  ["S10", a, { include: "3-1" }, "\n\n\n"],
  ["S11", a, { include: "0,2", zero: true }, "id,note\n1,x\n2,y\n"],
  ["S12", a, { include: ":1", zero: true }, "name\nA\nB\n"],
  ["S14", a, { include: "" }, a],
  ["S15", a, { include: " 1 ,+2" }, "id,name\n1,A\n2,B\n"],
  ["C01", a, { exclude: "name,999,missing,0" }, "id,note\n1,x\n2,y\n"],
  ["C02", a, { include: "2,1,2,3", exclude: "2" }, "id,note\n1,x\n2,y\n"],
  ["C03", a, { exclude: "1-3" }, "\n\n\n"],
  ["C04", a, { exclude: "2-" }, "id,note\n1,x\n2,y\n"],
  ["C05", a, { exclude: "3-1" }, a],
  ["R01", "a,b,c\n1\n2,3,4,5\n,,\n, ,0\n", { include: "3,1" }, "c,a\n,1\n4,2\n,\n0,\n"],
  ["R02", "a,b\n,keep\n ,\n0,\n,\n", { include: "1", deleteEmptyRows: true }, "a\n \n0\n"],
  ["R03", a, { exclude: "1-3", deleteEmptyRows: true }, "\n"],
  ["R04", "a\n\n\"\"\n", {}, "a\n\"\"\n\"\"\n"],
  ["R05", "a,b\nnull,001\n", {}, "a,b\nnull,001\n"],
  ["N01", a, { names: true }, "  1: id\n  2: name\n  3: note\n"],
  ["N02", "id,id,3,x-y,x:y\n", { names: true, zero: true }, "  0: id\n  1: id\n  2: 3\n  3: x-y\n  4: x:y\n"],
  ["N03", a, { names: true, include: "missing", exclude: "bad-range", deleteEmptyRows: true }, "  1: id\n  2: name\n  3: note\n"],
  ["N05", "", {}, "\n"],
  ["N05-H", "", { headerless: true }, "\n"],
  ["N07", "\n", { names: true }, ""],
  ["H01", "10,20\n30,40\n", { headerless: true }, "a,b\n10,20\n30,40\n"],
  ["H02", Array.from({ length: 29 }, (_, i) => i + 1).join(",") + "\n", { headerless: true, include: "26-29" }, "z,aa,bb,cc\n26,27,28,29\n"],
  ["H03", "ignored\n" + a, { dialect: { skipLines: 1 } }, a],
  ["H04", a, { dialect: { skipLines: 99 } }, "\n"],
  ["H05", a, { dialect: { skipLines: -1 } }, a],
  ["D01", "a\tb\n1\t2\n", { dialect: { tabs: true, delimiter: ";" } }, "a,b\n1,2\n"],
  ["D02", "a;b\n'one;two';'it''s'\n", { dialect: { delimiter: ";", quote: "'" } }, "a,b\none;two,it's\n"],
  ["D03", "a,b\n\"x\ny\",z\nq,r\n", {}, "a,b\n\"x\ny\",z\nq,r\n"],
  ["D04", "\ufeffa,b\r\n1,2\r\n", {}, "a,b\n1,2\n"],
  ["D07", "a,b\n1, 2\n", { dialect: { skipInitialSpace: true } }, "a,b\n1,2\n"],
  ["D10", "a,b\nx\\,y,z\n", { dialect: { quoting: 3, escape: "\\" } }, "a,b\n\"x,y\",z\n"],
  ["O01", "a,b\n,\nx,y\n,\nz,q\n", { lineNumbers: true, deleteEmptyRows: true }, "line_number,a,b\n1,x,y\n2,z,q\n"],
  ["O02", "a,b\n", { addBom: true, names: true }, "\ufeff  1: a\n  2: b\n"],
  ["P01", "a,b\n\"x\"q,y\n", {}, "a,b\nxq,y\n"],
  ["P06", "a\n\"x\r\ny\"\n", {}, "a\n\"x\n\ny\"\n"],
  ["P09", "a,b\n\"x\ny\",z\nq,r\n", { lineNumbers: true }, "line_number,a,b\n1,\"x\ny\",z\n2,q,r\n"]
];
for (const [id, input, options, output] of cases) test(id, async () => { assert.equal(await run(input, options), output); });

test("empty headers ignore selectors while preserving record output", async () => {
  for (const include of ["1", "missing"]) {
    assert.equal(await run("", { include }), "\n");
    assert.equal(await run("", { include, headerless: true }), "\n");
    assert.equal(await run("", { include, lineNumbers: true }), "line_number\n");
    assert.equal(await run("\nAda,1\n", { include }), "\n\n");
    assert.equal(await run("\nAda,1\n", { include, lineNumbers: true }), "line_number\n1\n");
    assert.equal(await run("\nAda,1\n", { include, deleteEmptyRows: true }), "\n");
    assert.equal(await run("\ufeff", { include, addBom: true }), "\ufeff\n");
    await assert.rejects(run("name,n\nAda,1\n", { include: "missing" }), { code: "INPUT" });
  }
});

test("empty-header projection still validates input and output quotas", async () => {
  await assert.rejects(run("\n\"unfinished", {
    include: "1", dialect: { profile: "utf8-sig-strict-v1" }
  }), { code: "INPUT" });
  await assert.rejects(run("", { include: "1" }, { limits: { outputBytes: 0 } }), { code: "LIMIT" });
  await assert.rejects(run("", { include: "missing" }, { limits: { argumentBytes: 0 } }), { code: "LIMIT" });
});

test("selector and strict parser errors precede ordinary output", async () => {
  for (const [input, options] of [
    [a, { include: "1-", zero: true }], [a, { include: " name" }],
    [a, { include: "0" }], [a, { include: "4" }], [a, { include: "1," }],
    [a, { exclude: "id-name" }], [a, { exclude: "2-4" }],
    [a, { include: "missing", exclude: "missing" }],
    ["a,b\n\"unfinished", { dialect: { profile: "utf8-sig-strict-v1" } }],
    ["", { names: true }], [a, { names: true, headerless: true }]
  ] as readonly [string, CsvcutOptions][]) {
    const out: Uint8Array[] = [];
    await assert.rejects(async () => {
      for await (const bytes of cutCsv(async function* () { yield encoder.encode(input); }, options, { signal: new AbortController().signal })) out.push(bytes);
    });
    assert.equal(out.length, 0);
  }
});
test("names stops parsing after the header even inside a producer chunk", async () => {
  assert.equal(await run('a,b\n"unfinished\0', { names: true, dialect: { profile: "utf8-sig-strict-v1" } }), "  1: a\n  2: b\n");
});

test("every byte boundary and reused producer storage preserve output", async () => {
  const input = '\ufeffa,b\r\n"é\nq","a""b"\r\n';
  const bytes = encoder.encode(input);
  for (let cut = 0; cut <= bytes.length; cut++) {
    const source = async function* () {
      yield bytes.subarray(0, cut);
      yield new Uint8Array();
      yield bytes.subarray(cut);
    };
    const output: Uint8Array[] = [];
    for await (const chunk of cutCsv(source, { include: "2,1,2" }, { signal: new AbortController().signal })) output.push(chunk);
    assert.equal(new TextDecoder().decode(Buffer.concat(output)), 'b,a,b\n"a""b","é\nq","a""b"\n');
  }
  const reused = new Uint8Array(2);
  const source = async function* () {
    for (const part of ["a,", "b\n", "x,", "y\n"]) { reused.set(encoder.encode(part)); yield reused; }
    reused.fill(0);
  };
  const output: Uint8Array[] = [];
  for await (const chunk of cutCsv(source, {}, { signal: new AbortController().signal })) output.push(chunk);
  assert.equal(new TextDecoder().decode(Buffer.concat(output)), "a,b\nx,y\n");
});

test("quota failures emit no ordinary output, retire once, and allow recovery", async () => {
  for (const limits of [
    { inputBytes: 1 }, { decodedBytes: 1 }, { retainedBytes: 1 }, { outputBytes: 1 },
    { work: 1 }, { fieldBytes: 1 }, { cells: 0 }, { scannedCells: 0 }, { argumentBytes: 0 }
  ]) {
    let retired = 0;
    const source = async function* () { try { yield encoder.encode(a); } finally { retired++; } };
    const output: Uint8Array[] = [];
    await assert.rejects(async () => {
      for await (const chunk of cutCsv(source, { include: "1" }, { signal: new AbortController().signal, limits })) output.push(chunk);
    }, { code: "LIMIT" });
    assert.equal(output.length, 0);
    assert.equal(retired, "work" in limits || "retainedBytes" in limits || "argumentBytes" in limits ? 0 : 1);
  }
  assert.equal(await run(a), a);
  assert.equal(await run("a\nx\n", {}, { limits: { inputBytes: 4, decodedBytes: 8, outputBytes: 4 } }), "a\nx\n");
  await assert.rejects(run("a\nx\n", {}, { limits: { outputBytes: 3 } }), { code: "LIMIT" });
});

test("registered cleanup precedes acquisition and closes admission", async () => {
  let cleanup!: () => Promise<void>;
  let acquired = 0;
  const source = async function* () { acquired++; yield encoder.encode(a); };
  const stream = cutCsv(source, {}, { signal: new AbortController().signal, registerCleanup(fn) { cleanup = fn; } });
  assert.equal(acquired, 0);
  const first = cleanup();
  assert.equal(cleanup(), first);
  await first;
  assert.equal((await stream.next()).done, true);
  assert.equal(acquired, 0);
});

test("cancellation of cooperative read preserves falsey reasons and retires once", async () => {
  for (const reason of [false, 0, "", null]) {
    const ac = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let retired = 0;
    let cleanup!: () => Promise<void>;
    const source = async function* (signal: AbortSignal): AsyncGenerator<Uint8Array> {
      try {
        ready();
        await new Promise<void>((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
        yield encoder.encode(a);
      } finally { retired++; }
    };
    const stream = cutCsv(source, {}, { signal: ac.signal, registerCleanup(fn) { cleanup = fn; } });
    const next = stream.next();
    const caught = next.then(() => "missing", error => error);
    await started;
    ac.abort(reason);
    assert.equal(await caught, reason);
    await cleanup();
    assert.equal(retired, 1);
  }
});

test("early output return retires once, snapshots options, and has owned output", async () => {
  const options = { include: "2,1", dialect: { delimiter: "," } };
  let retired = 0;
  const source = async function* () { try { yield encoder.encode("a,b\nx,y\n"); } finally { retired++; } };
  const stream = cutCsv(source, options, { signal: new AbortController().signal });
  options.include = "missing";
  options.dialect.delimiter = ";";
  const first = await stream.next();
  assert.equal(new TextDecoder().decode(first.value!), "b,a\n");
  first.value!.fill(0);
  assert.equal(new TextDecoder().decode((await stream.next()).value!), "y,x\n");
  await stream.return();
  assert.equal(retired, 1);
});

test("explicit BOM is preserved before a later failure", async () => {
  const output: Uint8Array[] = [];
  await assert.rejects(async () => {
    for await (const bytes of cutCsv(async function* () { yield encoder.encode(a); }, { addBom: true, include: "missing" }, { signal: new AbortController().signal })) output.push(bytes);
  }, { code: "INPUT" });
  assert.deepEqual([...Buffer.concat(output)], [239, 187, 191]);
});

test("pre-abort and cancellation between output records prevent new work", async () => {
  const ac = new AbortController();
  ac.abort(false);
  let acquired = 0;
  const source = async function* () { acquired++; yield encoder.encode(a); };
  let caught: unknown = "missing";
  try { await cutCsv(source, {}, { signal: ac.signal }).next(); } catch (error) { caught = error; }
  assert.equal(caught, false);
  assert.equal(acquired, 0);
  const mid = new AbortController();
  const stream = cutCsv(source, {}, { signal: mid.signal });
  assert.equal(new TextDecoder().decode((await stream.next()).value!), "id,name,note\n");
  mid.abort(0);
  try { await stream.next(); } catch (error) { caught = error; }
  assert.equal(caught, 0);
});

test("cleanup cancels and drains an admitted cooperative read", async () => {
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  let cleanup!: () => Promise<void>;
  let retired = 0;
  const source = async function* (signal: AbortSignal): AsyncGenerator<Uint8Array> {
    try {
      ready();
      await new Promise<void>((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      yield encoder.encode(a);
    } finally { retired++; }
  };
  const stream = cutCsv(source, {}, { signal: new AbortController().signal, registerCleanup(fn) { cleanup = fn; } });
  const next = stream.next();
  const caught = next.catch(error => error);
  await started;
  await cleanup();
  assert.equal((await caught).code, "INPUT");
  assert.equal(retired, 1);
  assert.equal((await stream.next()).done, true);
});

test("input retirement preserves primary failure identity and reports cleanup-only failures", async () => {
  for (const reason of [false, 0, "", null, undefined]) {
    for (const failRead of [true, false]) {
      let retired = 0;
      const source = () => ({ [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (failRead) throw reason;
            return { done: true, value: undefined };
          },
          async return(): Promise<IteratorResult<Uint8Array>> { retired++; throw failRead ? new Error("retire") : reason; }
        };
      } });
      let caught: unknown = "missing";
      try { await cutCsv(source, {}, { signal: new AbortController().signal }).next(); } catch (error) { caught = error; }
      assert.equal(caught, reason);
      assert.equal(retired, 1);
    }
  }
});

test("names preserves embedded text and expands beyond three display digits", async () => {
  assert.equal(await run('"a\nb","c\td"\n', { names: true }), "  1: a\nb\n  2: c\td\n");
  const input = Array(1000).fill("h").join(",") + "\n";
  const output = await run(input, { names: true });
  assert.ok(output.endsWith("999: h\n1000: h\n"));
  assert.equal(await run("\na,b\n"), "\n\n");
});

test("large or malformed ranges fail without expansion or output", async () => {
  for (const include of ["1:9999999999999999999999", "1:2-3", "1--2", "id:name"]) {
    await assert.rejects(run(a, { include }), { code: "INPUT" });
    await assert.rejects(run(a, { exclude: include }), { code: "INPUT" });
  }
});

test("names accounts for the full delivered input chunk without parsing its suffix", async () => {
  assert.equal(await run("a\n", { names: true }, { limits: { inputBytes: 2 } }), "  1: a\n");
  await assert.rejects(run("a\nx", { names: true }, { limits: { inputBytes: 2 } }), { code: "LIMIT" });
});

test("invalid producer chunks fail with a structured input error and retire once", async () => {
  const detached = encoder.encode("a\n");
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const value of [null, "a\n", {}, new DataView(new ArrayBuffer(2)), detached]) {
    let retired = 0;
    const source = async function* (): AsyncGenerator<Uint8Array> {
      try { yield value as unknown as Uint8Array; }
      finally { retired++; }
    };
    const output: Uint8Array[] = [];
    await assert.rejects(async () => {
      for await (const chunk of cutCsv(source, {}, { signal: new AbortController().signal })) output.push(chunk);
    }, { code: "INPUT" });
    assert.equal(output.length, 0);
    assert.equal(retired, 1);
  }
  assert.equal(await run(a), a);
});

test("invalid UTF-8 is rejected even in an unselected excess cell", async () => {
  for (const profile of ["utf8-sig-permissive-v1", "utf8-sig-strict-v1"] as const) {
    for (const suffix of [[0xff], [0xe2, 0x82]]) {
      const output: Uint8Array[] = [];
      const source = async function* () {
        yield encoder.encode("a\nx,");
        yield new Uint8Array(suffix);
      };
      await assert.rejects(async () => {
        for await (const chunk of cutCsv(source, { include: "1", dialect: { profile } }, { signal: new AbortController().signal })) output.push(chunk);
      }, { code: "INPUT" });
      assert.equal(output.length, 0);
    }
  }
});

test("empty producer chunks consume work and cannot evade invocation limits", async () => {
  let retired = 0;
  const source = async function* () {
    try { while (true) yield new Uint8Array(); }
    finally { retired++; }
  };
  await assert.rejects(cutCsv(source, {}, {
    signal: new AbortController().signal, limits: { work: 4 }
  }).next(), { code: "LIMIT" });
  assert.equal(retired, 1);
});

test("projection uses the actual byte view without invoking producer properties", async () => {
  const storage = encoder.encode("ignored\na,b\nx,y\nignored");
  const view = storage.subarray(8, 16);
  for (const key of ["byteLength", "buffer", "byteOffset", "constructor"]) {
    Object.defineProperty(view, key, { get() { throw new Error(`Producer ${key} accessed`); } });
  }
  const output: Uint8Array[] = [];
  const source = async function* () { yield view; };
  for await (const chunk of cutCsv(source, { include: "2,1" }, { signal: new AbortController().signal, limits: { inputBytes: 8 } })) output.push(chunk);
  assert.equal(new TextDecoder().decode(Buffer.concat(output)), "b,a\ny,x\n");
});

test("UTF-8 output admission counts encoded scalars and an explicit BOM", async () => {
  for (const addBom of [false, true]) {
    const input = "a\né😀\n";
    const expected = (addBom ? "\ufeff" : "") + input;
    const size = addBom ? 12 : 9;
    assert.equal(await run(input, { addBom }, { limits: { outputBytes: size } }), expected);
    const output: Uint8Array[] = [];
    await assert.rejects(async () => {
      for await (const chunk of cutCsv(async function* () { yield encoder.encode(input); }, { addBom }, {
        signal: new AbortController().signal, limits: { outputBytes: size - 1 }
      })) output.push(chunk);
    }, { code: "LIMIT" });
    assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.concat(output)), addBom ? "\ufeff" : "");
  }
});

test("byte source rejects other typed-array element types, including forged brands", async () => {
  for (const value of [
    new Int8Array([97, 10]), new Uint8ClampedArray([97, 10]),
    new Uint16Array([97, 10]), new Float32Array([97, 10]),
    new BigUint64Array([97n, 10n]),
    runInNewContext("new Uint16Array([97, 10])") as Uint16Array
  ]) {
    Object.defineProperty(value, Symbol.toStringTag, { value: "Uint8Array" });
    let retired = 0;
    const output: Uint8Array[] = [];
    const source = async function* (): AsyncGenerator<Uint8Array> {
      try { yield value as unknown as Uint8Array; }
      finally { retired++; }
    };
    await assert.rejects(async () => {
      for await (const chunk of cutCsv(source, {}, { signal: new AbortController().signal })) output.push(chunk);
    }, { code: "INPUT", message: "Invalid CSV byte chunk" });
    assert.equal(output.length, 0);
    assert.equal(retired, 1);
  }
});

test("byte source admits Uint8Array across realms without consulting its public brand", async () => {
  for (const value of [
    encoder.encode("a,b\nx,y\n"), Buffer.from("a,b\nx,y\n"),
    runInNewContext("new Uint8Array([97,44,98,10,120,44,121,10])") as Uint8Array
  ]) {
    Object.defineProperty(value, Symbol.toStringTag, { get() { throw new Error("Public brand accessed"); } });
    const output: Uint8Array[] = [];
    for await (const chunk of cutCsv(async function* () { yield value; }, { include: "2,1,2" }, {
      signal: new AbortController().signal, limits: { inputBytes: 8 }
    })) output.push(chunk);
    assert.equal(new TextDecoder().decode(Buffer.concat(output)), "b,a,b\ny,x,y\n");
  }
});

test("blank and comma-bearing headers use exact names before range parsing", async () => {
  assert.equal(await run(',"left,right",x-y,x:y,\nA,B,C,D,E\n', {
    include: "x:y,x-y,,1", exclude: "x-y,missing"
  }), "x:y,,\nD,A,A\n");
  assert.equal(await run(',"left,right",x-y,x:y,\nA,B,C,D,E\n', {
    include: "2,2,5", exclude: "1,3,999"
  }), '"left,right","left,right",\nB,B,E\n');
});

test('projection shares an invocation ledger without resetting or disposing caller accounting', async () => {
  const signal = new AbortController().signal, budget = new CsvBudget({ outputBytes: 4 }, signal);
  budget.charge('outputBytes', 2);
  await assert.rejects(async () => {
    for await (const chunk of cutCsv(async function* () { yield encoder.encode('abc\n'); }, {}, { signal, budget })) void chunk;
  }, { code: 'LIMIT' });
  budget.charge('work', 1);
  assert.equal(budget.accounting.outputBytes, 2);
  budget.dispose();
});
