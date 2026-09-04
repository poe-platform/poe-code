import assert from "node:assert/strict";
import test from "node:test";
import { FsError, toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { textCommands } from "../../../src/commands/text.js";
import { SortRecordBudget } from "../../../src/commands/sort-admission.js";

const originalAdmit = SortRecordBudget.prototype.admit;
const originalUint8Array = Uint8Array;

async function execute(args: readonly string[], stdin: ByteSource, fs = new MemoryFileSystem(), signal = new AbortController().signal) {
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const definition = textCommands().find(command => command.name === "sort")!;
  const result = await definition.execute({
    command: "sort", args, stdin, fs, signal, cwd: "/", env: {},
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const args of [[], ["-u"], ["-n"], ["-k1,1"], ["-c"], ["-cu"], ["-z"]]) {
  for (const shape of ["one chunk", "fragmented", "unterminated"] as const) {
    test(`sort ${args.join(" ")} admits ${shape} completed records before allocation`, async context => {
      const delimiter = args.includes("-z") ? 0 : 10;
      const record = Buffer.alloc(113, 98);
      const chunks = shape === "one chunk"
        ? [Buffer.concat([Buffer.from([97, delimiter]), record, Buffer.from([delimiter])])]
        : [Buffer.concat([Buffer.from([97, delimiter]), record.subarray(0, 57)]),
          Buffer.concat([record.subarray(57), Buffer.from(shape === "unterminated" ? [] : [delimiter])])];
      const admissions: number[] = [];
      let refuse = true, allocations = 0, closed = 0;
      SortRecordBudget.prototype.admit = function (byteLength) {
        admissions.push(byteLength);
        if (refuse && byteLength === record.length) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
        originalAdmit.call(this, byteLength);
      };
      globalThis.Uint8Array = new Proxy(originalUint8Array, { construct(target, argumentsList, newTarget) {
        const input: unknown = argumentsList[0];
        if (input === record.length || input instanceof originalUint8Array && input.byteLength === record.length) allocations++;
        return Reflect.construct(target, argumentsList, newTarget);
      } });
      context.after(() => { SortRecordBudget.prototype.admit = originalAdmit; globalThis.Uint8Array = originalUint8Array; });
      const source = async function* () { try { yield* chunks; } finally { closed++; } };
      const result = await execute(args, source());
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, "sort: EFBIG: sort buffer limit exceeded\n");
      assert.equal(result.stdout.length, 0);
      assert.deepEqual(admissions, [1, 113]);
      assert.equal(allocations, 0, "refusal precedes completed-record copy or concatenation");
      assert.equal(closed, 1);
      refuse = false;
      const control = await execute(args, source());
      assert.equal(control.exitCode, 0, control.stderr);
      assert(allocations > 0, "the observer must see admitted completed-record allocation");
      assert.equal(closed, 2);
    });
  }
}

test("sort shares one record budget across operands and preserves output on refusal", async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one", Buffer.from("a\n"));
  await fs.writeFile("/two", Buffer.from("b\n"));
  await fs.writeFile("/out", Buffer.from("unchanged"));
  const owners = new Set<SortRecordBudget>();
  let calls = 0;
  SortRecordBudget.prototype.admit = function (length) {
    owners.add(this);
    if (++calls === 2) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
    originalAdmit.call(this, length);
  };
  context.after(() => { SortRecordBudget.prototype.admit = originalAdmit; });
  const result = await execute(["-o", "/out", "/one", "/two"], toByteSource(""), fs);
  assert.equal(result.exitCode, 2);
  assert.equal(calls, 2);
  assert.equal(owners.size, 1);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "unchanged");
});

for (const args of [["-c"], ["-cu"]]) {
  test(`sort ${args.join(" ")} stops on disorder before later records or operand reads`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/one", Buffer.from(args.includes("-cu") ? "a\na\nc\n" : "b\na\nc\n"));
    const admissions: number[] = [];
    SortRecordBudget.prototype.admit = function (length) { admissions.push(length); originalAdmit.call(this, length); };
    context.after(() => { SortRecordBudget.prototype.admit = originalAdmit; });
    const result = await execute([...args, "/one", "/missing"], toByteSource(""), fs);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "sort: disorder at record 2\n");
    assert.deepEqual(admissions, [1, 1]);
  });
}

test("sort check mode keeps delimiter accounting and raw producer bytes", async context => {
  const admissions: number[] = [];
  SortRecordBudget.prototype.admit = function (length) { admissions.push(length); originalAdmit.call(this, length); };
  context.after(() => { SortRecordBudget.prototype.admit = originalAdmit; });
  const buffer = Buffer.alloc(3);
  const stdin = (async function* () {
    try {
      buffer.set([97, 255, 0]); yield buffer;
      buffer.set([98, 128, 0]); yield buffer;
      buffer[0] = 99; yield buffer.subarray(0, 1);
    } finally { buffer.fill(0); }
  })();
  const result = await execute(["-cz"], stdin);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(admissions, [2, 2, 1]);
});

test("sort admission fixtures restore constructors and methods", () => {
  assert.equal(SortRecordBudget.prototype.admit, originalAdmit);
  assert.equal(globalThis.Uint8Array, originalUint8Array);
});
