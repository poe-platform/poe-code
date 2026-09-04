import assert from "node:assert/strict";
import test from "node:test";
import { FsError, MemoryFileSystem, Shell, standardCommands, type ByteSource } from "../../../src/index.js";
import { SortRecordBudget } from "../../../src/commands/sort-admission.js";

for (const flags of ["", "-n", "-u", "-c", "-cu", "-z"]) {
  test(`public sort ${flags} admits a record before its full allocation`, async () => {
    const delimiter = flags === "-z" ? "\0" : "\n";
    const bytes = Buffer.from(`1${delimiter}${"2".repeat(37)}${delimiter}`);
    const admission = Object.getOwnPropertyDescriptor(SortRecordBudget.prototype, "admit")!;
    const allocation = Object.getOwnPropertyDescriptor(globalThis, "Uint8Array")!;
    const admitted: number[] = [];
    let rejectedCopies = 0;
    Object.defineProperty(SortRecordBudget.prototype, "admit", { ...admission, value(this: SortRecordBudget, length: number) {
      admitted.push(length);
      if (admitted.length === 2) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
      Reflect.apply(admission.value, this, [length]);
    } });
    Object.defineProperty(globalThis, "Uint8Array", { ...allocation, value: new Proxy(Uint8Array, {
      construct(target, args, newTarget) {
        if (args[0] === 37 || args[0] instanceof target && args[0].byteLength === 37) rejectedCopies++;
        return Reflect.construct(target, args, newTarget);
      },
    }) });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    try {
      const result = await shell.exec(`sort ${flags}`, { stdin: (async function* () { yield bytes; })() });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "sort: EFBIG: sort buffer limit exceeded\n");
      assert.deepEqual(admitted, [1, 37]);
      assert.equal(rejectedCopies, 0);
      new Uint8Array(37);
      assert.equal(rejectedCopies, 1, "observer detects the rejected-size allocation");
    } finally {
      Object.defineProperty(globalThis, "Uint8Array", allocation);
      Object.defineProperty(SortRecordBudget.prototype, "admit", admission);
      await shell.dispose();
    }
    assert.equal(globalThis.Uint8Array, allocation.value);
    assert.equal(SortRecordBudget.prototype.admit, admission.value);
  });
}

for (const [flags, input, expected] of [
  ["", [], []], ["", [10], [10]], ["", [10, 10], [10, 10]],
  ["", [98, 10, 97], [97, 10, 98, 10]],
  ["", [255, 10, 128, 10, 0, 10], [0, 10, 128, 10, 255, 10]],
  ["-z", [255, 0, 128, 0, 10], [10, 0, 128, 0, 255, 0]],
  ["-n", [50, 10, 49, 48, 10, 49], [49, 10, 50, 10, 49, 48, 10]],
  ["-u", [98, 10, 97, 10, 98, 10], [97, 10, 98, 10]],
] as const) test(`public sort ${flags} preserves byte records ${JSON.stringify(input)}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    const result = await shell.exec(`sort ${flags}`, { stdin: Uint8Array.from(input) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.from(expected));
  } finally { await shell.dispose(); }
});

test("record admission is invocation-wide across operands and preserves output on refusal", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("a\nb\n"));
  await fs.writeFile("/second", Buffer.from("c\n"));
  await fs.writeFile("/out", Buffer.from("unchanged"));
  const descriptor = Object.getOwnPropertyDescriptor(SortRecordBudget.prototype, "admit")!;
  const counts = new WeakMap<SortRecordBudget, number>();
  Object.defineProperty(SortRecordBudget.prototype, "admit", { ...descriptor, value(this: SortRecordBudget, length: number) {
    const count = (counts.get(this) ?? 0) + 1;
    counts.set(this, count);
    if (count === 3) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
    Reflect.apply(descriptor.value, this, [length]);
  } });
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("sort -o /out /first /second");
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "unchanged");
    const next = await shell.exec("sort /first");
    assert.equal(next.exitCode, 0, next.stderr);
    assert.equal(next.stdout, "a\nb\n");
  } finally { Object.defineProperty(SortRecordBudget.prototype, "admit", descriptor); await shell.dispose(); }
  assert.equal(SortRecordBudget.prototype.admit, descriptor.value);
});

test("record admission failure takes precedence over disorder on that same record", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(SortRecordBudget.prototype, "admit")!;
  let records = 0;
  Object.defineProperty(SortRecordBudget.prototype, "admit", { ...descriptor, value(this: SortRecordBudget, length: number) {
    if (++records === 3) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
    Reflect.apply(descriptor.value, this, [length]);
  } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    const result = await shell.exec("sort -c", { stdin: "a\nb\na\n" });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stderr, "sort: EFBIG: sort buffer limit exceeded\n");
    assert.equal(result.stdout, "");
    assert.equal(records, 3);
  } finally { Object.defineProperty(SortRecordBudget.prototype, "admit", descriptor); await shell.dispose(); }
});

test("unterminated operands form independent records, including empty files", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("b"));
  await fs.writeFile("/empty", new Uint8Array());
  await fs.writeFile("/second", Buffer.from("a\n"));
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("sort /first /empty /second");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a\nb\n");
  } finally { await shell.dispose(); }
});

for (const flags of ["-c", "-cu", "-cnu"]) test(`sort ${flags} reports global record number and stops before later source failure`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("1\n"));
  await fs.writeFile("/second", Buffer.from(flags === "-c" ? "2\n0\n" : "2\n2\n"));
  const original = fs.readStream.bind(fs);
  let pulledPastDisorder = false;
  let closed = false;
  fs.readStream = (path, options) => path !== "/second" ? original(path, options) : (async function* (): ByteSource {
    try {
      yield Buffer.from(flags === "-c" ? "2\n0\n" : "2\n2\n");
      pulledPastDisorder = true;
      throw new FsError("EIO", { message: "must not read past disorder" });
    } finally { closed = true; }
  })();
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec(`sort ${flags} /first /second`);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "sort: disorder at record 3\n");
    assert.equal(result.stdout, "");
    assert.equal(pulledPastDisorder, false);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});

for (const delimiter of [10, 0]) test(`sort owns reused producer views before pull and completion, delimiter ${delimiter}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("placeholder"));
  const original = fs.readStream.bind(fs);
  const source = Uint8Array.of(98, 255, delimiter, 97, 128, delimiter);
  fs.readStream = (path, options) => path !== "/input" ? original(path, options) : (async function* () {
    const backing = Buffer.alloc(9, 42);
    const view = backing.subarray(3, 5);
    try { for (let offset = 0; offset < source.length; offset += 2) { view.set(source.subarray(offset, offset + 2)); yield view; } }
    finally { backing.fill(0); }
  })();
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec(`sort ${delimiter === 0 ? "-z" : ""} /input`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(97, 128, delimiter, 98, 255, delimiter));
  } finally { await shell.dispose(); }
});

for (const reason of [null, false, 0, ""]) test(`sort preserves cancellation reason ${JSON.stringify(reason)} during collection`, async () => {
  const controller = new AbortController();
  let closed = false;
  const source = (async function* () {
    try { yield Buffer.from("a\n"); controller.abort(reason); yield Buffer.from("b\n"); }
    finally { closed = true; }
  })();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    await assert.rejects(shell.exec("sort", { stdin: source, signal: controller.signal }), error => error === reason);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});
