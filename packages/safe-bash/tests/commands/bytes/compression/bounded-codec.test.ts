import { strict as assert } from "node:assert";
import { test } from "node:test";
import { boundedCodec, type CodecStep, type BoundedCodec } from "../../../../src/commands/bytes/compression/bounded-codec.js";
import { CodecReader } from "../../../../src/commands/bytes/compression/codec.js";
import { createCodec } from "../../../../src/commands/bytes/compression/codec-loader.js";
import type { RawCodecModule } from "../../../../src/commands/bytes/compression/native/types.js";

const options = { format: "xz", decompress: true, level: 1 } as const;
const input = (...values: Uint8Array[]) => new CodecReader((async function* () { yield* values; })(), new AbortController().signal);
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of source) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
}
function fake(step: BoundedCodec["step"], close: () => void = () => {}): BoundedCodec {
  return { step, close };
}

test("bounded codec retains frame remainder and stops under output backpressure", async () => {
  let creates = 0, closes = 0, steps = 0;
  const output = boundedCodec(input(Uint8Array.of(4, 5, 6)), options, new AbortController().signal, () => {
    creates++;
    return fake((bytes, out) => { steps++; out[0] = bytes[0]!; return { consumed: 1, produced: 1, status: "end" }; }, () => { closes++; });
  });
  const first = await output.next();
  assert.deepEqual(first.value, Uint8Array.of(4));
  assert.equal(steps, 1);
  assert.equal(creates, 1);
  assert.deepEqual(await collect(output), Uint8Array.of(5, 6));
  assert.equal(creates, 3);
  assert.equal(closes, 3);
  assert.deepEqual(first.value, Uint8Array.of(4), "published output must not be reused");
});

test("bounded codec never gives a step input or output larger than 64 KiB", async () => {
  let total = 0;
  const bytes = new Uint8Array(150000).fill(7);
  const result = await collect(boundedCodec(input(bytes), { ...options, decompress: false }, new AbortController().signal, () => fake((chunk, out, finish) => {
    assert.ok(chunk.length <= 65536 && out.length <= 65536);
    total += chunk.length;
    out.set(chunk);
    return { consumed: chunk.length, produced: chunk.length, status: finish ? "end" : "input" };
  })));
  assert.equal(total, bytes.length);
  assert.deepEqual(result, bytes);
});

for (const bad of [
  { consumed: -1, produced: 0, status: "input" },
  { consumed: 2, produced: 0, status: "input" },
  { consumed: 0, produced: 65537, status: "output" },
  { consumed: NaN, produced: 0, status: "input" },
  { consumed: 0, produced: 0, status: "input" },
] as const) {
  test(`bounded codec rejects invalid progress ${JSON.stringify(bad)} and closes`, async () => {
    let closes = 0;
    await assert.rejects(collect(boundedCodec(input(Uint8Array.of(1)), options, new AbortController().signal,
      () => fake(() => bad as CodecStep, () => { closes++; }))));
    assert.equal(closes, 1);
  });
}

test("bounded codec refuses truncated input and empty compressed input", async () => {
  for (const bytes of [new Uint8Array(), Uint8Array.of(1)]) {
    let closed = false;
    await assert.rejects(collect(boundedCodec(input(bytes), options, new AbortController().signal,
      () => fake((chunk) => ({ consumed: chunk.length, produced: 0, status: "input" }), () => { closed = true; }))), /unexpected end/u);
    assert.equal(closed, true);
  }
});

for (const reason of [false, { stop: "codec" }]) {
  test(`bounded codec yields during no-output work and preserves abort ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    let closes = 0, steps = 0;
    const timer = setTimeout(() => controller.abort(reason), 0);
    try {
      await assert.rejects(collect(boundedCodec(input(new Uint8Array(65536)), options, controller.signal, () => fake(() => {
        steps++;
        return { consumed: 1, produced: 0, status: "input" };
      }, () => { closes++; }))), error => error === reason);
      assert.ok(steps < 65536);
      assert.equal(closes, 1);
    } finally { clearTimeout(timer); }
  });
}

test("bounded codec cancellation after acquisition closes before any step", async () => {
  const controller = new AbortController();
  const reason = { stop: true };
  let closed = false;
  await assert.rejects(collect(boundedCodec(input(Uint8Array.of(1)), options, controller.signal, () => {
    controller.abort(reason);
    return fake(() => { throw new Error("must not step"); }, () => { closed = true; });
  })), error => error === reason);
  assert.equal(closed, true);
});

test("bounded codec consumer retirement closes the instance without pulling more input", async () => {
  let pulls = 0, closed = false;
  const reader = { async chunk() { pulls++; return Uint8Array.of(1); }, restore() {} };
  const output = boundedCodec(reader, options, new AbortController().signal, () => fake((bytes, out) => {
    out[0] = bytes[0]!; return { consumed: 1, produced: 1, status: "output" };
  }, () => { closed = true; }));
  await output.next();
  await output.return(undefined);
  assert.equal(closed, true);
  assert.equal(pulls, 1);
});

test("bounded codec preserves source failure and reports it once", async () => {
  const error = { input: false }, failures: unknown[] = [];
  let closed = false;
  await assert.rejects(collect(boundedCodec({ async chunk() { throw error; }, restore() {} },
    { ...options, onFailure: value => { failures.push(value); } }, new AbortController().signal,
    () => fake(() => { throw new Error("must not step"); }, () => { closed = true; }))), value => value === error);
  assert.deepEqual(failures, [error]);
  assert.equal(closed, true);
});

test("bounded codec retains primary step error when cleanup also fails", async () => {
  const reason = { malformed: true };
  await assert.rejects(collect(boundedCodec(input(Uint8Array.of(1)), options, new AbortController().signal,
    () => fake(() => { throw reason; }, () => { throw new Error("cleanup"); }))), error => error === reason);
});

test("bounded codec can finish draining and request the next input without output", async () => {
  let stage = 0;
  const result = await collect(boundedCodec(input(Uint8Array.of(1)), options, new AbortController().signal,
    () => fake((bytes, out) => {
      if (stage++ === 0) { out[0] = bytes[0]!; return { consumed: 1, produced: 1, status: "output" }; }
      if (stage === 2) return { consumed: 0, produced: 0, status: "input" };
      return { consumed: 0, produced: 0, status: "end" };
    })));
  assert.deepEqual(result, Uint8Array.of(1));
});

test("XZ accepts aligned stream padding split across chunks and preserves following members", async () => {
  let creates = 0;
  const output = await collect(boundedCodec(input(Uint8Array.of(1, 0), Uint8Array.of(0, 0), Uint8Array.of(0, 2, 0, 0, 0, 0)), options,
    new AbortController().signal, () => {
      creates++;
      return fake((bytes, out) => {
        assert.notEqual(bytes[0], 0, "padding is not a new stream");
        out[0] = bytes[0]!;
        return { consumed: 1, produced: 1, status: "end" };
      });
    }));
  assert.deepEqual(output, Uint8Array.of(1, 2));
  assert.equal(creates, 2);
});

test("XZ rejects incomplete padding before EOF or another member", async () => {
  for (const bytes of [Uint8Array.of(1, 0), Uint8Array.of(1, 0, 2)]) {
    await assert.rejects(collect(boundedCodec(input(bytes), options, new AbortController().signal,
      () => fake(() => ({ consumed: 1, produced: 0, status: "end" })))), /padding/u);
  }
});

test("XZ padding scanning yields for live cancellation", async () => {
  const controller = new AbortController();
  const reason = { stop: "padding" };
  const bytes = new Uint8Array(1 + 1024 * 1024); bytes[0] = 1;
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(collect(boundedCodec(input(bytes), options, controller.signal,
      () => fake(() => ({ consumed: 1, produced: 0, status: "end" })))), error => error === reason);
  } finally { clearTimeout(timer); }
});

function raw(overrides: Partial<RawCodecModule> = {}): RawCodecModule {
  return {
    memory: { buffer: new ArrayBuffer(128 * 1024) },
    bridge_create() { return 0; }, bridge_destroy() {},
    bridge_input() { return 0; }, bridge_output() { return 65536; },
    bridge_consumed() { return 1; }, bridge_produced() { return 1; },
    bridge_step() { return 1; }, bridge_used() { return 0; }, bridge_peak() { return 0; },
    ...overrides,
  };
}

test("codec loader enforces owned input/output and idempotent cleanup", async () => {
  let closes = 0;
  const module = raw({ bridge_destroy() { closes++; } });
  const codec = await createCodec(options, new AbortController().signal, () => module);
  new Uint8Array(module.memory.buffer)[65536] = 9;
  const out = new Uint8Array(4);
  assert.deepEqual(codec.step(Uint8Array.of(7), out, false), { consumed: 1, produced: 1, status: "end" });
  assert.equal(new Uint8Array(module.memory.buffer)[0], 7);
  assert.equal(out[0], 9);
  new Uint8Array(module.memory.buffer)[65536] = 3;
  assert.equal(out[0], 9);
  codec.close(); codec.close();
  assert.equal(closes, 1);
  assert.throws(() => codec.step(Uint8Array.of(1), out, false), /closed/u);
});

test("codec loader rejects oversize buffers before native invocation", async () => {
  let steps = 0;
  const codec = await createCodec(options, new AbortController().signal, () => raw({ bridge_step() { steps++; return 1; } }));
  try {
    assert.throws(() => codec.step(new Uint8Array(65537), new Uint8Array(1), false), /size/u);
    assert.throws(() => codec.step(new Uint8Array(1), new Uint8Array(65537), false), /size/u);
    assert.equal(steps, 0);
  } finally { codec.close(); }
});

test("codec loader destroys failed initialization and preserves abort identity", async () => {
  let closes = 0;
  await assert.rejects(createCodec(options, new AbortController().signal, () => raw({
    bridge_create() { return -2; }, bridge_destroy() { closes++; },
  })), /memory|initializ/u);
  assert.equal(closes, 1);
  const controller = new AbortController(); const reason = false;
  await assert.rejects(createCodec(options, controller.signal, () => raw({
    bridge_create() { controller.abort(reason); return 0; }, bridge_destroy() { closes++; },
  })), error => error === reason);
  assert.equal(closes, 2);
});

test("codec loader maps truncation and corrupt-data failures to diagnostics", async () => {
  for (const [status, message] of [[-4, /unexpected end/u], [-3, /corrupt|memory/u]] as const) {
    const codec = await createCodec(options, new AbortController().signal, () => raw({ bridge_step() { return status; } }));
    try { assert.throws(() => codec.step(Uint8Array.of(1), new Uint8Array(1), true), message); }
    finally { codec.close(); }
  }
});
