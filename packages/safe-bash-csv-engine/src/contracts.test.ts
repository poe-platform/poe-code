import assert from "node:assert/strict";
import { test } from "node:test";
import { CsvBudget, CsvParser, resolveColumns, generatedHeaders } from "./index.js";
const enc = new TextEncoder();
const budget = (): CsvBudget => new CsvBudget({}, new AbortController().signal);

test("public accounting cannot reset quota usage and snapshots survive disposal", () => {
  const b = new CsvBudget({ inputBytes: 1 }, new AbortController().signal);
  b.charge("inputBytes", 1);
  b.charge("retainedBytes", 8);
  const observed = b.accounting;
  assert.equal(Reflect.set(observed, "inputBytes", 0), false);
  assert.throws(() => b.charge("inputBytes", 1), { code: "LIMIT" });
  b.dispose();
  assert.equal(observed.retainedBytes, 8);
  assert.equal(b.accounting.retainedBytes, 0);
  assert.equal(b.accounting.peakRetainedBytes, 8);
});

test("byte admission uses actual storage length without invoking producer accessors", () => {
  for (const accessor of [false, true]) {
    const bytes = Uint8Array.of(97, 10);
    let reads = 0;
    Object.defineProperty(bytes, "byteLength", accessor
      ? { get() { reads++; return 0; } }
      : { value: 0 });
    const b = new CsvBudget({ inputBytes: 1 }, new AbortController().signal);
    const p = new CsvParser({ profile: "utf8-sig-strict-v1" }, b);
    assert.throws(() => p.push(bytes), { code: "LIMIT" });
    assert.equal(reads, 0);
    assert.equal(b.accounting.inputBytes, 0);
    assert.equal(b.accounting.retainedBytes, 0);
  }
});

test("dialect characters are Unicode scalars, including split supplementary bytes", () => {
  const bytes = enc.encode('a💠b\r\n🟢x\ny🟢💠🟢a🟢🟢b🟢\r\nx🔑💠y💠z\n');
  for (let split = 0; split <= bytes.length; split++) {
    const p = new CsvParser({ profile: "utf8-sig-strict-v1", delimiter: "💠", quote: "🟢", escape: "🔑" }, budget());
    assert.deepEqual([...p.push(bytes.subarray(0, split)), ...p.push(bytes.subarray(split)), ...p.end()], [
      { cells: ["a", "b"], line: 1 },
      { cells: ["x\ny", "a🟢b"], line: 3 },
      { cells: ["x💠y", "z"], line: 4 }
    ]);
  }
  for (const char of ["", "ab", "💠a", "\ud800", "\udc00", "\r", "\n", "\0"])
    for (const key of ["delimiter", "quote", "escape"])
      assert.throws(() => new CsvParser({ [key]: char }, budget()), { code: "ARGUMENT" });
});

test("generated header counts reject invalid arguments before allocation", () => {
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const b = budget();
    assert.throws(() => generatedHeaders(count, b), { code: "ARGUMENT" });
    assert.equal(b.accounting.retainedBytes, 0);
    assert.equal(b.accounting.work, 0);
  }
  assert.deepEqual(generatedHeaders(0, budget()), []);
});

test("empty pure operations still enforce cancellation and invocation lifetime", () => {
  for (const operation of [
    (b: CsvBudget) => generatedHeaders(0, b),
    (b: CsvBudget) => resolveColumns({}, [], b)
  ]) {
    const closed = budget();
    closed.dispose();
    assert.throws(() => operation(closed), { code: "INPUT" });
    const ac = new AbortController();
    const cancelled = new CsvBudget({}, ac.signal);
    ac.abort(false);
    let reason: unknown = "missing";
    try { operation(cancelled); } catch (error) { reason = error; }
    assert.equal(reason, false);
  }
});

test("invalid resource limits and charges return structured argument errors", () => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new CsvBudget({ inputBytes: value }, new AbortController().signal), { code: "ARGUMENT" });
    const b = budget();
    assert.throws(() => b.charge("inputBytes", value), { code: "ARGUMENT" });
    assert.equal(b.accounting.inputBytes, 0);
  }
});

test("strict-v1 preserves records at every byte boundary", () => {
  const bytes = enc.encode('\ufeffa,b,\r\n"é\r\nx","a""b",\r\n\n""\n');
  for (let split = 0; split <= bytes.length; split++) {
    const p = new CsvParser({ profile: "utf8-sig-strict-v1" }, budget());
    assert.deepEqual([...p.push(bytes.subarray(0, split)), ...p.push(bytes.subarray(split)), ...p.end()], [
      { cells: ["a", "b", ""], line: 1 },
      { cells: ["é\r\nx", 'a"b', ""], line: 3 },
      { cells: [], line: 4 },
      { cells: [""], line: 5 }
    ]);
  }
  assert.deepEqual(new CsvParser({ profile: "utf8-sig-strict-v1" }, budget()).end(), []);
});
test("strict-v1 rejects unfinished quotes, closure garbage, escape EOF and NUL", () => {
  for (const input of ['"unfinished', '"a"b\n', '"a"\\b\n', '\\a"b"\n', 'a\\', 'a\0\n']) {
    const p = new CsvParser({ profile: "utf8-sig-strict-v1", escape: "\\" }, budget());
    assert.throws(() => { p.push(enc.encode(input)); p.end(); }, { code: "INPUT" });
  }
});
test("strict dialect controls, empty cells and physical skipping stay independent", () => {
  const p = new CsvParser({ profile: "utf8-sig-strict-v1", tabs: true, delimiter: ";", quote: "'", escape: "\\", skipInitialSpace: true, skipLines: 1 }, budget());
  assert.deepEqual([...p.push(enc.encode("ignored\r\na\tb\r\n 'x\\'y'\t\r\n")), ...p.end()], [
    { cells: ["a", "b"], line: 1 }, { cells: ["x'y", ""], line: 2 }
  ]);
  for (const input of [",", ",\n", ",\r\n"] ) {
    const q = new CsvParser({ profile: "utf8-sig-strict-v1" }, budget());
    assert.deepEqual([...q.push(enc.encode(input)), ...q.end()], [{ cells: ["", ""], line: 1 }]);
  }
  const none = new CsvParser({ profile: "utf8-sig-strict-v1", quoting: 3, escape: "\\" }, budget());
  assert.deepEqual([...none.push(enc.encode('"a",x\\,y\n')), ...none.end()], [{ cells: ['"a"', "x,y"], line: 1 }]);
});
test("explicit unsupported quoting and profile fail before decoding", () => {
  for (const dialect of [{ quoting: 2 }, { profile: "python-3.12" }])
    assert.throws(() => new CsvParser(dialect as never, budget()), { code: "UNSUPPORTED" });
});
test("parser captures dialect ownership and disposed ledgers cannot be reused", () => {
  const dialect = { delimiter: ";", quote: '"' };
  const p = new CsvParser(dialect, budget());
  dialect.delimiter = ",";
  dialect.quote = "'";
  assert.deepEqual(p.push(enc.encode('a;"b;c"\n')), [{ cells: ["a", "b;c"], line: 1 }]);
  const b = budget();
  b.dispose();
  assert.throws(() => b.charge("retainedBytes", 1), { code: "INPUT" });
});
test("strict failures and all resource axes have independent controls", () => {
  for (const limits of [{ fieldBytes: 1 }, { cells: 0 }, { inputBytes: 0 }, { decodedBytes: 0 }, { retainedBytes: 0 }, { work: 0 }]) {
    const p = new CsvParser({ profile: "utf8-sig-strict-v1" }, new CsvBudget(limits, new AbortController().signal));
    assert.throws(() => p.push(enc.encode("a\n")), { code: "LIMIT" });
  }
  for (const bytes of [Uint8Array.of(255), Uint8Array.of(0xc3)]) {
    const p = new CsvParser({ profile: "utf8-sig-strict-v1" }, budget());
    assert.throws(() => { p.push(bytes); p.end(); }, { code: "INPUT" });
  }
  assert.throws(() => resolveColumns({ include: "1-2" }, ["a", "b"], new CsvBudget({ work: 1 }, new AbortController().signal)), { code: "LIMIT" });
});
test("strict parser disposal is terminal and cancellation preserves falsey reason", () => {
  const p = new CsvParser({}, budget());
  p.push(enc.encode('"held'));
  p.dispose();
  p.dispose();
  assert.throws(() => p.push(enc.encode("x")), { code: "INPUT" });
  const ac = new AbortController();
  const q = new CsvParser({}, new CsvBudget({}, ac.signal));
  ac.abort(0);
  let caught: unknown = "missing";
  try { q.end(); } catch (error) { caught = error; }
  assert.equal(caught, 0);
});
test("release selectors independently control colon, open ranges, zero and exclusions", () => {
  const headers = ["id", "id", "3", "x-y", "x:y"];
  assert.deepEqual(resolveColumns({ include: "id,3,id,x-y,x:y" }, headers, budget()), [0, 2, 0, 3, 4]);
  assert.deepEqual(resolveColumns({ include: ":2,2-,3-1" }, ["a", "b", "c"], budget()), [0, 1, 1, 2]);
  assert.deepEqual(resolveColumns({ include: ":1", zero: true }, ["a", "b", "c"], budget()), [1]);
  assert.throws(() => resolveColumns({ include: "1-", zero: true }, ["a", "b", "c"], budget()), { code: "INPUT" });
  assert.deepEqual(resolveColumns({ include: "2,1,2,3", exclude: "2,999,missing,0" }, ["a", "b", "c"], budget()), [0, 2]);
  assert.deepEqual(resolveColumns({ exclude: "2-" }, ["a", "b", "c"], budget()), [0, 2]);
  assert.throws(() => resolveColumns({ exclude: "2-4" }, ["a", "b", "c"], budget()), { code: "INPUT" });
  assert.throws(() => resolveColumns({ exclude: "a-b" }, ["a", "b"], budget()), { code: "INPUT" });
  assert.deepEqual(resolveColumns({ include: " 1 ,+2" }, ["a", "b"], budget()), [0, 1]);
  assert.throws(() => resolveColumns({ include: " a" }, ["a"], budget()), { code: "INPUT" });
  assert.deepEqual(resolveColumns({ include: "" }, ["a", "b"], budget()), [0, 1]);
  assert.deepEqual(resolveColumns({ include: "1," }, ["id", ""], budget()), [0, 1]);
});

test("valid signed zero remains positional before hyphen range fallback", () => {
  assert.deepEqual(resolveColumns({ include: "-0, -00 ", zero: true }, ["a", "b"], budget()), [0, 0]);
  assert.deepEqual(resolveColumns({ exclude: "-0", zero: true }, ["a", "b"], budget()), [1]);
  assert.deepEqual(resolveColumns({ include: "-2" }, ["a", "b", "c"], budget()), [0, 1]);
});
