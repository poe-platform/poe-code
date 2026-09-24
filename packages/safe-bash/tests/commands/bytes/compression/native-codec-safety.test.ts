import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedCodec, type BoundedCodecOptions, type CodecFactory } from "../../../../src/commands/bytes/compression/bounded-codec.js";
import { createCodec } from "../../../../src/commands/bytes/compression/codec-loader.js";
import { CodecReader } from "../../../../src/commands/bytes/compression/codec.js";
import bz2 from "../../../../src/commands/bytes/compression/native/generated/bz2.mjs";
import xz from "../../../../src/commands/bytes/compression/native/generated/xz.mjs";
import zstd from "../../../../src/commands/bytes/compression/native/generated/zstd.mjs";
import type { RawCodecModule } from "../../../../src/commands/bytes/compression/native/types.js";
import { transform } from "../../../../src/commands/bytes/compression/stream.js";
import { parseOptions } from "../../../../src/commands/bytes/compression/options.js";
import { zipLzma } from "../../../../src/commands/archive/zip/lzma.js";

const factories = { bzip2: bz2, xz, zstd };
const formats = ["bzip2", "xz", "zstd"] as const;
async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) { assert.ok(chunk.length <= 65536); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function tracked() {
  const modules: RawCodecModule[] = [];
  const create: CodecFactory = (options, signal) => createCodec(options, signal, wasi => {
    const module = factories[options.format](wasi); modules.push(module); return module;
  });
  return { create, modules, released() { assert.ok(modules.length); for (const module of modules) assert.equal(module.bridge_used(), 0); } };
}
function reader(bytes: Uint8Array, signal: AbortSignal) {
  return new CodecReader((async function* () { yield bytes; })(), signal);
}
async function encode(bytes: Uint8Array, format: BoundedCodecOptions["format"]) {
  const signal = new AbortController().signal;
  return collect(boundedCodec(reader(bytes, signal), { format, level: 1, decompress: false }, signal));
}

for (const format of formats) {
  test(`${format} pipeline honors aggregate output limits before the sink receives excess bytes`, async () => {
    const encoded = await encode(Buffer.alloc(100000, 65), format);
    let written = 0;
    await assert.rejects(transform((async function* () { yield encoded; })(), async output => {
      for await (const chunk of output) written += chunk.length;
    }, parseOptions(format, ["-dc"]), new AbortController().signal, 32), /exceeds 32 bytes/u);
    assert.equal(written, 0);
  });

  test(`${format} pipeline cancels a blocked sink and pending source without further writes`, async () => {
    const encoded = await encode(Buffer.alloc(300000, 65), format);
    const controller = new AbortController(), reason = { sink: format };
    let enter!: () => void, returned = false, writes = 0, pulls = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const cancelled = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.throwIfAborted();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const result = transform(signal => (async function* () {
      try { pulls++; yield encoded; pulls++; await cancelled(signal); }
      finally { returned = true; }
    })(), async (output, signal) => {
      for await (const ignoredChunk of output) { writes++; enter(); await cancelled(signal); }
    }, parseOptions(format, ["-dc"]), controller.signal);
    await entered;
    assert.equal(writes, 1);
    controller.abort(reason);
    await assert.rejects(result, error => error === reason);
    assert.equal(writes, 1);
    assert.ok(pulls <= 2);
    assert.equal(returned, true);
  });

  test(`${format} real driver rejects malformed/truncated data, retires and recovers`, async () => {
    const plain = Buffer.from("actual codec bytes\n".repeat(200));
    const encoded = await encode(plain, format);
    for (const bad of [Uint8Array.of(1, 2, 3, 4), encoded.subarray(0, encoded.length - 2)]) {
      const state = tracked(), signal = new AbortController().signal;
      await assert.rejects(collect(boundedCodec(reader(bad, signal), { format, level: 1, decompress: true }, signal, state.create)));
      state.released();
    }
    const state = tracked(), signal = new AbortController().signal;
    assert.deepEqual(await collect(boundedCodec(reader(encoded, signal), { format, level: 1, decompress: true }, signal, state.create)), plain);
    state.released();
  });

  test(`${format} actual source and blocked-output cancellation close codec state`, async () => {
    const encoded = await encode(Buffer.alloc(300000, 65), format);
    for (const reason of [false, { cancel: format }]) {
      const controller = new AbortController(), state = tracked();
      const output = boundedCodec(reader(encoded, controller.signal), { format, level: 1, decompress: true }, controller.signal, state.create);
      const first = await output.next();
      assert.equal(first.done, false);
      controller.abort(reason);
      await assert.rejects(output.next(), error => error === reason);
      state.released();
    }
    const controller = new AbortController(), state = tracked(), reason = { source: format };
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const source = {
      async chunk(): Promise<Uint8Array | undefined> {
        entered();
        return new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
      },
      restore() {},
    };
    const result = collect(boundedCodec(source, { format, level: 1, decompress: true }, controller.signal, state.create));
    await waiting; controller.abort(reason);
    await assert.rejects(result, error => error === reason);
    state.released();
  });
}

test("actual codec instances run concurrently with independent bytes and cleanup", async () => {
  await Promise.all(formats.map(async format => {
    const plain = Buffer.from(format.repeat(10000)), encoded = await encode(plain, format);
    const state = tracked(), signal = new AbortController().signal;
    const joined = Buffer.concat([encoded, encoded]);
    assert.deepEqual(await collect(boundedCodec(reader(joined, signal), { format, level: 1, decompress: true }, signal, state.create)), Buffer.concat([plain, plain]));
    assert.equal(state.modules.length, 2);
    state.released();
  }));
});

test("host workspace ceiling rejects tiny XZ and Zstandard frames before large allocation", async () => {
  // Python lzma FORMAT_XZ, LZMA2 dict_size=128 MiB, payload 'hello'; native checksum retained.
  const hugeDictionary = Buffer.from("/Td6WFoAAATm1rRGAgAhAR4AAACbB1FmAQAEaGVsbG8AAAAAsTe52+XaHpsAAR0FuC2Arx+2830BAAAAAARZWg==", "base64");
  // RFC 8878: 128 MiB window, one-byte raw final block.
  const hugeWindow = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0, 0x88, 9, 0, 0, 65);
  for (const [format, bytes] of [["xz", hugeDictionary], ["zstd", hugeWindow]] as const) {
    const state = tracked(), signal = new AbortController().signal;
    await assert.rejects(collect(boundedCodec(reader(bytes, signal), { format, level: 1, decompress: true }, signal, state.create)), /memory limit/u);
    assert.ok(state.modules.every(module => module.bridge_peak() < 1024 * 1024));
    state.released();
  }
});

test("XZ encoder and ZIP LZMA dictionary admission precede workspace allocation", async () => {
  for (const options of [
    { format: "xz", level: 6, decompress: false },
    { format: "xz", level: 1, decompress: true, lzma: { dictionary: 128 * 1024 * 1024, properties: 93, eos: true, size: 1 } },
  ] satisfies BoundedCodecOptions[]) {
    const state = tracked();
    await assert.rejects(async () => state.create(options, new AbortController().signal), /memory limit/u);
    assert.ok(state.modules.every(module => module.bridge_peak() < 1024 * 1024));
    state.released();
  }
});

test("zero and oversized caller limits cannot lift the host XZ workspace ceiling", async () => {
  const bytes = Buffer.from("/Td6WFoAAATm1rRGAgAhAR4AAACbB1FmAQAEaGVsbG8AAAAAsTe52+XaHpsAAR0FuC2Arx+2830BAAAAAARZWg==", "base64");
  for (const xzDecompressMemory of [0, 8 * 1024 ** 3]) {
    const state = tracked(), signal = new AbortController().signal;
    await assert.rejects(collect(boundedCodec(reader(bytes, signal), { format: "xz", level: 1, decompress: true, xzDecompressMemory }, signal, state.create)), /memory limit/u);
    assert.ok(state.modules.every(module => module.bridge_peak() < 1024 * 1024));
    state.released();
  }
});

test("ZIP LZMA rejects a nine-byte header requesting a 128 MiB dictionary", async () => {
  const signal = new AbortController().signal;
  const bytes = Uint8Array.of(9, 4, 5, 0, 93, 0, 0, 0, 8);
  await assert.rejects(collect(zipLzma(reader(bytes, signal), signal, { decode: true, level: 1, eos: true, size: 1 })), /memory limit/u);
});

test("Zstandard long-distance encoding cannot raise the host window ceiling", async () => {
  await assert.rejects(createCodec({
    format: "zstd", decompress: false, level: 1,
    zstd: { check: true, literals: 0, row: 0, window: 27, sizeHint: 0 },
  }, new AbortController().signal), /unsupported Zstandard codec parameters/u);
});

test("native entry points enforce the host ceiling even without the JS loader", () => {
  for (const [low, high] of [[0, 0], [0, 2]]) {
    const module = xz({ fd_prestat_get: () => 8 });
    module._initialize?.();
    assert.equal(module.bridge_create(0, 6, low!, 30, 4, 0, 0, high), -2);
    assert.equal(module.bridge_peak(), 0);
    assert.equal(module.bridge_create_lzma!(1, 1, low!, 128 * 1024 * 1024, 93, 1, 1, 0, high), -2);
    assert.equal(module.bridge_peak(), 0);
    module.bridge_destroy();
    assert.equal(module.bridge_used(), 0);
  }
});

test("XZ and Zstandard verify checksums within the first frame", async () => {
  for (const format of ["xz", "zstd"] as const) {
    const encoded = await encode(Buffer.from("checksum bytes"), format);
    const bad = encoded.slice();
    if (format === "xz") bad[bad.length - 24] = bad[bad.length - 24]! ^ 1;
    else {
      assert.equal(bad[4]! & 4, 4);
      bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    }
    const codec = await createCodec({ format, level: 1, decompress: true }, new AbortController().signal);
    try { assert.throws(() => codec.step(bad, new Uint8Array(65536), true), /compressed data/u); }
    finally { codec.close(); }
  }
});

test("native bzip2 level-nine 900 KB fixture yields bounded output and cancellable work", async () => {
  // Python bz2.compress(bytes(i % 251 for i in range(900000)), compresslevel=9).
  const encoded = Buffer.from("QlpoOTFBWSZTWQD5nUcABwD////////////////////////////////////////////wYAe/AAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAA00AAAAAAAAAAAAAAAAAAAA0IAAAAAAAAAAAAAAAAAAAAA00AAAAAAAAAAAAAAAAAAAA0IAAAAAAAAAAAAAAAAAAAAA00AAAAAAAAAAAAAAAAAAAA0IAAAAAAAAAAAAAAAAAAAAA00AAAAAAAAAAAAAAAAAAAA0IAAAAAAAAAAAAAAAAAAAAA00AAAAAAAAAAAAAAAAAAAA0BSqqgAAAAAAAAA0AAAAAAAAABoAAADIAAAAAAAAAAAAAAAABphIArB4WgFYYgFYagFYcgFYegFYggFYigFYkgFYmgFYogFYqgFYsgFYugFYwgFYygFY0gFY2gFY4gFY6gFY8gFY+gFZAgFZCgFZEgFZGgFZIgFZKgFZMgFZOgFZQgFZSgFZUgFZWgFZYgFZagFZcgFZegFZggFZigFZkgFZmgFZogFZqgFZsgFZugFZwgFZygFZ0gFZ2gFZ4gFZ6gFZ8gFZ+gFaAgFaCgFaEgFaGgFYBAK0RAK0VAK0ZAK0dAK0hAK0lAK0pAK0tAK0xAK01AK05AK09AK1BAK1FAK1JAK1NAK1RAK1VAK1ZAK1dAK1hAK1lAK1pAK1tAK1xAK11AK15AK19AK2BAK2FAK2JAK2NAK2RAK2VAK2ZAK2dAK2hAK2lAK2pAK2tAK2xAK21AK25AK29AK3BAK3FAK3JAK3NAK3RAK3VAK3ZAK3dAK3hAK3lAK3pAK3tAK3xAK31AK35AK39AKwKAVwCAVwKAVwSAVwaAVwiAVwqAVwyAVw6AVxCAVxKAVxSAVxaAVxiAVxqAVxyAVx6AVyCAVyKAVySAVyaAVyiAVyqAVyyAVy6AVgkArBoBWCgCuYgCuZgCuagCubgCucgCudgCuegCufgCuggCuhgCuigCujgCukgCulgCumgCungCuogCupgCuqgCurgCusgCutgCuugCuvgCuwgCuxgCuygCuzgCu0gCu1gCu2gCu3gCu4gCu5gCu6gCu7gCu8gCu9gCu+gCu/gCvAgCvBgCvCgCvDgCvEgCvFgCvGgCvHgCvIgCvJgCvKgCvLgCvMgCvNgCvOgCvPgCvQgCvRgCvSgCvTgCvUgCvVgCvWgCvXgCvYgCvZgCvagCvbgCvcgCvdgCvegCvfgCvggCvhgCvigCvjgCvkgCvlgCvmgCvngCvogCvpgCvqgCvrgCvsgCvtgCvugCvvgCvwgCvxgCvygCvzgCv0gCv1gCv2gCv3gCv4gCv5gCv6gCv7gCv8gCv9gCv+gCsJAFf+YoKyTKay5RJUkAAAAABgP//4AEAAYpkxMgyMIJkNAyYkrGl8ZXW+d8z/iaF3JFOFCQc3oQxg==", "base64");
  const state = tracked(), signal = new AbortController().signal;
  const plain = await collect(boundedCodec(reader(encoded, signal), { format: "bzip2", level: 9, decompress: true }, signal, state.create));
  assert.equal(plain.length, 900000);
  assert.ok(plain.every((value, index) => value === index % 251));
  state.released();
  const corrupted = encoded.slice(); corrupted[10] = corrupted[10]! ^ 1;
  await assert.rejects(collect(boundedCodec(reader(corrupted, signal), { format: "bzip2", level: 9, decompress: true }, signal)));
  for (const reason of [false, { work: "bzip2" }]) {
    const controller = new AbortController(), cancelled = tracked();
    const timer = setTimeout(() => controller.abort(reason), 0);
    try {
      await assert.rejects(collect(boundedCodec(reader(encoded, controller.signal), { format: "bzip2", level: 9, decompress: true }, controller.signal, cancelled.create)), error => error === reason);
      cancelled.released();
    } finally { clearTimeout(timer); }
  }
});


test("successful codec completion propagates a cleanup failure", async () => {
  const signal = new AbortController().signal;
  const reason = new Error("cleanup failure");
  const output = boundedCodec(reader(new Uint8Array(), signal),
    { format: "xz", level: 1, decompress: false }, signal,
    () => ({ step: () => ({ consumed: 0, produced: 0, status: "end" }), close() { throw reason; } }));
  await assert.rejects(collect(output), error => error === reason);
});
