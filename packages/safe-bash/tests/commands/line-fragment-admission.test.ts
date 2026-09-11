import assert from "node:assert/strict";
import test from "node:test";
import { bufferLimit, lines } from "../../src/commands/internal.js";
import { RecordBuffer } from "../../src/commands/record-buffer.js";
import { FsError, type ByteSource } from "../../src/contracts/index.js";
import { run } from "./helpers.js";

async function withAllocations(action: (allocations: number[]) => Promise<void>): Promise<void> {
  const original = Uint8Array;
  const allocations: number[] = [];
  globalThis.Uint8Array = new Proxy(original, {
    construct(target, argumentsList) {
      const result = Reflect.construct(target, argumentsList) as Uint8Array;
      allocations.push(result.length);
      return result;
    },
  });
  try { await action(allocations); }
  finally { globalThis.Uint8Array = original; }
}

function reusedBytes(): ByteSource {
  const window = Buffer.alloc(1);
  return (async function* () {
    try {
      for (let value = 65; value < 73; value++) {
        window[0] = value;
        yield window;
      }
    } finally { window.fill(0); }
  })();
}

test("lines retains eight one-byte fragments in one owned segment", async () => {
  await withAllocations(async allocations => {
    const records = [];
    for await (const line of lines(reusedBytes())) records.push(line);
    assert.deepEqual([...records[0]!.bytes], [65, 66, 67, 68, 69, 70, 71, 72]);
    assert.equal(records[0]!.terminated, false);
    assert.deepEqual(allocations, [4096, 8]);
  });
});

test("sort retains eight one-byte fragments without per-fragment owned copies", async () => {
  await withAllocations(async allocations => {
    const result = await run("sort", [], { stdin: reusedBytes() });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "ABCDEFGH\n");
    assert.equal(allocations.filter(length => length === 1).length, 0);
  });
});

for (const count of [8, 16]) {
  for (const command of ["lines", "sort", "sort -c"] as const) {
    test(`${command} directly finalizes ${count} complete short records without scratch segments`, async () => {
      const input = Buffer.from("a\n".repeat(count));
      async function* source(): ByteSource {
        try { yield input; }
        finally { input.fill(0); }
      }
      await withAllocations(async allocations => {
        if (command === "lines") {
          const records = [];
          for await (const record of lines(source())) records.push(record);
          assert.equal(records.length, count);
          for (const record of records) {
            assert.deepEqual([...record.bytes], [97]);
            assert.equal(record.terminated, true);
          }
        } else {
          const result = await run("sort", command === "sort -c" ? ["-c"] : [], { stdin: source() });
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, command === "sort" ? "a\n".repeat(count) : "");
        }
        assert.deepEqual(allocations.filter(length => command !== "sort" || length !== 64 * 1024), Array<number>(count).fill(1));
      });
      assert.ok(input.every(byte => byte === 0));
    });
  }
}

test("record directly finalizes an owned offset span after all admission", async () => {
  const record = new RecordBuffer(5, 5);
  const input = Buffer.from([255, 1, 2, 3, 4, 5, 255]);
  await withAllocations(async allocations => {
    const output = record.finish(size => {
      assert.equal(size, 5);
      assert.deepEqual(allocations, []);
    }, input, 1, 6);
    assert.deepEqual(allocations, [5]);
    input.fill(0, 1, 6);
    assert.deepEqual([...output], [1, 2, 3, 4, 5]);
    assert.equal(record.size, 0);
    assert.equal(input[0], 255);
    assert.equal(input[6], 255);
  });
});

test("record rejects direct final spans before line, aggregate or overlap copying", async () => {
  const input = Buffer.from([1, 2, 3]);
  Object.defineProperty(input, "subarray", { value() { return assert.fail("copied rejected final span"); } });
  const failure = new FsError("EFBIG", { message: "aggregate full" });
  await withAllocations(async allocations => {
    assert.throws(() => new RecordBuffer(2).finish(() => {
      assert.fail("aggregate called before line admission");
    }, input), { code: "EFBIG", message: "EFBIG: line buffer limit exceeded" });
    assert.throws(() => new RecordBuffer(3).finish(size => {
      assert.equal(size, 3);
      throw failure;
    }, input), error => error === failure);
    assert.throws(() => new RecordBuffer(3, 2).finish(undefined, input), {
      code: "EFBIG", message: "EFBIG: line finalization buffer limit exceeded",
    });
    assert.deepEqual(allocations, []);
  });
});

test("record final span shares admission with pending fragments without another segment", async () => {
  const record = new RecordBuffer(5);
  const input = Buffer.from([3, 4, 5, 6]);
  await withAllocations(async allocations => {
    record.append(Buffer.from([1, 2]));
    assert.throws(() => record.finish(() => {
      assert.fail("aggregate called before pending plus final span admission");
    }, input), { code: "EFBIG", message: "EFBIG: line buffer limit exceeded" });
    assert.equal(record.size, 2);
    assert.deepEqual(allocations, [5]);
    const output = record.finish(size => { assert.equal(size, 5); }, input, 0, 3);
    assert.deepEqual([...output], [1, 2, 3, 4, 5]);
    assert.deepEqual(allocations, [5, 5]);
    input.fill(0);
    assert.deepEqual([...output], [1, 2, 3, 4, 5]);
  });
});

test("record admission rejects the whole span before allocation or copying", async () => {
  const record = new RecordBuffer(5);
  const first = Buffer.from([1, 2, 3]);
  const overflow = Buffer.from([4, 5, 6]);
  Object.defineProperty(overflow, "subarray", { value() { return assert.fail("copied rejected span"); } });
  await withAllocations(async allocations => {
    record.append(first);
    assert.deepEqual(allocations, [5]);
    assert.throws(() => record.append(overflow), { code: "EFBIG", message: "EFBIG: line buffer limit exceeded" });
    assert.deepEqual(allocations, [5]);
    assert.equal(record.size, 3);
    record.append(Buffer.from([4, 5]));
    assert.deepEqual([...record.finish()], [1, 2, 3, 4, 5]);
    assert.deepEqual(allocations, [5, 5]);
    assert.equal(record.size, 0);
  });
});

test("record segments are lazy and cap the last allocation to logical capacity", async () => {
  const record = new RecordBuffer(4099);
  const first = Buffer.alloc(4096, 65);
  await withAllocations(async allocations => {
    record.append(Buffer.alloc(0));
    assert.deepEqual(allocations, []);
    record.append(first);
    record.append(Buffer.from([66, 67, 68]));
    assert.deepEqual(allocations, [4096, 3]);
    const result = record.finish();
    assert.equal(result.length, 4099);
    assert.ok(result.subarray(0, 4096).every(byte => byte === 65));
    assert.deepEqual([...result.subarray(4096)], [66, 67, 68]);
    assert.deepEqual(allocations, [4096, 3, 4099]);
  });
});

test("record finalization admits segment/output overlap before exact allocation", async () => {
  const record = new RecordBuffer(5, 8);
  await withAllocations(async allocations => {
    record.append(Buffer.from([1, 2, 3, 4]));
    assert.throws(() => record.finish(), { code: "EFBIG", message: "EFBIG: line finalization buffer limit exceeded" });
    assert.deepEqual(allocations, [5]);
    assert.equal(record.size, 4);
    record.clear();
    record.append(Buffer.from([5, 6, 7]));
    assert.deepEqual([...record.finish()], [5, 6, 7]);
    assert.deepEqual(allocations, [5, 5, 3]);
  });
});

test("record aggregate admission runs before exact allocation and preserves rejected bytes", async () => {
  const record = new RecordBuffer(5);
  const failure = new FsError("EFBIG", { message: "aggregate full" });
  await withAllocations(async allocations => {
    record.append(Buffer.from([1, 2]));
    assert.throws(() => record.finish(size => {
      assert.equal(size, 2);
      throw failure;
    }), error => error === failure);
    assert.deepEqual(allocations, [5]);
    assert.equal(record.size, 2);
    assert.deepEqual([...record.finish()], [1, 2]);
  });
});

for (const kind of ["Buffer", "Uint8Array"] as const) {
  test(`record owns offset ${kind} spans and never reuses returned output`, () => {
    const backing = kind === "Buffer" ? Buffer.alloc(7, 255) : new Uint8Array(7).fill(255);
    const record = new RecordBuffer(5);
    backing.set([65, 66, 67], 2);
    record.append(backing, 2, 5);
    backing.fill(0, 2, 5);
    const first = record.finish();
    backing.set([68, 69], 2);
    record.append(backing, 2, 4);
    const second = record.finish();
    backing.fill(0, 2, 5);
    assert.deepEqual([...first], [65, 66, 67]);
    assert.deepEqual([...second], [68, 69]);
    assert.equal(backing[1], 255);
    assert.equal(backing[5], 255);
  });
}

for (const delimiter of [10, 0]) {
  test(`lines preserves empty, split and EOF records with separator ${delimiter}`, async () => {
    const window = Buffer.alloc(2);
    let closed = false;
    async function* source(): ByteSource {
      try {
        yield Buffer.alloc(0);
        for (const payload of [[delimiter, 65], [66, delimiter], [delimiter, 67], [68]]) {
          window.set(payload);
          yield window.subarray(0, payload.length);
        }
      } finally { window.fill(0); closed = true; }
    }
    const admitted: number[] = [];
    const records = [];
    for await (const record of lines(source(), delimiter, size => { admitted.push(size); })) records.push(record);
    assert.deepEqual(records.map(record => [[...record.bytes], record.terminated]), [
      [[], true], [[65, 66], true], [[], true], [[67, 68], false],
    ]);
    assert.deepEqual(admitted, [0, 2, 0, 2]);
    assert.equal(closed, true);
  });
}

test("lines closes its producer on early return or rejected finalization", async () => {
  let closed = 0;
  let reads = 0;
  async function* source(): ByteSource {
    try {
      reads++;
      yield Buffer.from([65, 10, 66]);
      reads++;
      yield Buffer.from([67]);
    } finally { closed++; }
  }
  for await (const line of lines(source())) {
    assert.deepEqual([...line.bytes], [65]);
    break;
  }
  const failure = new Error("admission refused");
  await withAllocations(async allocations => {
    await assert.rejects(async () => {
      for await (const line of lines(source(), 10, () => { throw failure; })) assert.fail(String(line));
    }, error => error === failure);
    assert.deepEqual(allocations, []);
  });
  assert.equal(reads, 2);
  assert.equal(closed, 2);
});

for (const reason of [0, false, "", null]) {
  test(`lines preserves falsey source failure ${JSON.stringify(reason)} and cleanup`, async () => {
    let closed = false;
    async function* source(): ByteSource {
      try { yield Buffer.from([65]); throw reason; }
      finally { closed = true; }
    }
    await assert.rejects(async () => {
      for await (const line of lines(source())) assert.fail(String(line));
    }, error => error === reason);
    assert.equal(closed, true);
  });

  for (const args of [[], ["-c"]]) {
    test(`sort ${args.join(" ")} preserves falsey cancellation ${JSON.stringify(reason)} and cleanup`, async () => {
      const controller = new AbortController();
      let closed = false;
      async function* source(): ByteSource {
        try {
          yield Buffer.from([65]);
          controller.abort(reason);
          yield Buffer.from([10]);
        } finally { closed = true; }
      }
      await assert.rejects(run("sort", args, { stdin: source(), signal: controller.signal }), error => error === reason);
      assert.equal(closed, true);
    });
  }
}

for (const args of [[], ["-c"]]) {
  for (const specimen of [
    { name: "exact capacity with no extra EOF record", records: [[10], [10]], materialized: [0, 0], exitCode: 0 },
    { name: "separator alone exceeds capacity", records: [[10], [10], [10]], materialized: [0, 0], exitCode: 2 },
    { name: "unterminated record still charges separator", records: [[10], [65]], materialized: [0], exitCode: 2 },
  ]) {
    test(`sort ${args.join(" ")} admits before materialization: ${specimen.name} (synthetic prior charge)`, async context => {
      const finish = RecordBuffer.prototype.finish;
      const materialized: number[] = [];
      let calls = 0;
      let closed = false;
      let reads = 0;
      context.mock.method(RecordBuffer.prototype, "finish", function(
        this: RecordBuffer, admit?: (size: number) => void, bytes?: Uint8Array, start?: number, end?: number,
      ) {
        assert.ok(admit);
        const result = finish.call(this, size => { admit(calls++ === 0 ? bufferLimit - 2 : size); }, bytes, start, end);
        materialized.push(result.length);
        return result;
      });
      async function* source(): ByteSource {
        try {
          for (const bytes of specimen.records) { reads++; yield Buffer.from(bytes); }
        } finally { closed = true; }
      }
      const result = await run("sort", args, { stdin: source() });
      assert.equal(result.exitCode, specimen.exitCode, result.stderr);
      assert.equal(result.stderr, specimen.exitCode ? "sort: EFBIG: sort buffer limit exceeded\n" : "");
      assert.equal(result.stdout, !specimen.exitCode && !args.length ? "\n\n" : "");
      assert.deepEqual(materialized, specimen.materialized);
      assert.equal(reads, specimen.records.length);
      assert.equal(closed, true);
    });
  }
}
