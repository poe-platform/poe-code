import { expect, it } from "vitest";
import { createCompressionCodec } from "./index.js";

const block = Uint8Array.of(0x33, 0x34, 0x32, 0x36, 0x31, 0x35, 0x33, 0xb7, 0xb0, 0x04, 0x00);
const signal = new AbortController().signal;

it("gunzip does not discard members or invalid data after zero padding", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  const input = new CodecReader((async function* () { yield new TextEncoder().encode("a\n"); })(), signal);
  const member: number[] = [];
  for await (const chunk of codec(input, { mode: "gzip" }, signal)) member.push(...chunk);
  await input.close();
  for (const chunked of [false, true]) {
    const source = (async function* () {
      if (chunked) { yield Uint8Array.from(member); yield Uint8Array.of(0, 0); yield Uint8Array.from(member); }
      else yield Uint8Array.from([...member, 0, 0, ...member]);
    })();
    const reader = new CodecReader(source, signal);
    const output: number[] = [];
    try { for await (const chunk of codec(reader, { mode: "gunzip", padding: "members" }, signal)) output.push(...chunk); }
    finally { await reader.close(); }
    expect(new TextDecoder().decode(Uint8Array.from(output))).toBe("a\na\n");
  }
  const reader = new CodecReader((async function* () { yield Uint8Array.from([...member, 0, 0, 1, 2]); })(), signal);
  try {
    await expect(async () => { for await (const chunk of codec(reader, { mode: "gunzip", padding: "members" }, signal)) void chunk; }).rejects.toThrow();
  } finally { await reader.close(); }
});

it("consumes reused source windows and publishes stable output chunks", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  let closed = 0;
  const buffer = new Uint8Array(1);
  const source = (async function* () {
    try {
      for (const byte of block) {
        buffer[0] = byte;
        yield buffer;
      }
    } finally {
      closed++;
      buffer.fill(0);
    }
  })();
  const reader = new CodecReader(source, signal);
  const output: Uint8Array[] = [];
  for await (const chunk of codec(reader, { mode: "inflate-raw", chunkSize: 3 }, signal))
    output.push(chunk);
  expect(output).toEqual([
    Uint8Array.of(49, 50, 51),
    Uint8Array.of(52, 53, 54),
    Uint8Array.of(55, 56, 57)
  ]);
  expect(closed).toBe(0);
  await reader.close();
  await reader.close();
  expect(closed).toBe(1);
  expect(output[0]).toEqual(Uint8Array.of(49, 50, 51));
});

it("returns unread bytes to the same reader without acquiring another source chunk", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  let pulls = 0;
  const bytes = Uint8Array.from([...block, 101, 102]);
  const reader = new CodecReader(
    (async function* () {
      pulls++;
      yield bytes;
      pulls++;
    })(),
    signal
  );
  for await (const chunk of codec(reader, { mode: "inflate-raw" }, signal))
    expect(chunk).toEqual(new TextEncoder().encode("123456789"));
  expect(await reader.chunk()).toEqual(Uint8Array.of(101, 102));
  expect(pulls).toBe(1);
  await reader.close();
});

it("leaves source retirement with its reader when the output consumer stops", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  let closed = 0;
  const reader = new CodecReader(
    (async function* () {
      try {
        yield block;
      } finally {
        closed++;
      }
    })(),
    signal
  );
  for await (const chunk of codec(reader, { mode: "inflate-raw", chunkSize: 1 }, signal)) {
    expect(chunk).toEqual(Uint8Array.of(49));
    break;
  }
  expect(closed).toBe(0);
  await reader.close();
  expect(closed).toBe(1);
});

it("preserves exact abort identity and retires the reader once", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  let closed = 0;
  const controller = new AbortController();
  const reason = { stop: true };
  const reader = new CodecReader(
    (async function* () {
      try {
        yield block;
      } finally {
        closed++;
      }
    })(),
    controller.signal
  );
  const output = codec(reader, { mode: "inflate-raw", chunkSize: 1 }, controller.signal)[
    Symbol.asyncIterator
  ]();
  expect((await output.next()).value).toEqual(Uint8Array.of(49));
  controller.abort(reason);
  await expect(output.next()).rejects.toBe(reason);
  await reader.close();
  await reader.close();
  expect(closed).toBe(1);
});

it("rejects truncated compressed data without swallowing source errors", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  for (const input of [block.subarray(0, 4), Uint8Array.of(0xff)]) {
    const reader = new CodecReader(
      (async function* () {
        yield input;
      })(),
      signal
    );
    try {
      await expect(async () => {
        for await (const chunk of codec(reader, { mode: "inflate-raw" }, signal)) void chunk;
      }).rejects.toThrow();
    } finally {
      await reader.close();
    }
  }
  const failure = new Error("source failed");
  const reader = new CodecReader(
    (async function* () {
      yield block.subarray(0, 1);
      throw failure;
    })(),
    signal
  );
  try {
    await expect(async () => {
      for await (const chunk of codec(reader, { mode: "inflate-raw" }, signal)) void chunk;
    }).rejects.toBe(failure);
  } finally {
    await reader.close();
  }
});


it("uses explicit zlib framing with independently encoded data", async () => {
  const { deflateSync, inflateSync } = await import("node:zlib");
  const plain = new TextEncoder().encode("independent zlib vector".repeat(10000));
  const { codec, CodecReader } = createCompressionCodec();
  for (const mode of ["inflate-zlib", "deflate-zlib"] as const) {
    const bytes = mode === "inflate-zlib" ? deflateSync(plain) : plain;
    const reader = new CodecReader((async function* () {
      for (let offset = 0; offset < bytes.length; offset += 997) yield bytes.subarray(offset, offset + 997);
    })(), signal);
    const chunks: Uint8Array[] = [];
    try { for await (const chunk of codec(reader, { mode, chunkSize: 1024 }, signal)) {
      expect(chunk.length).toBeLessThanOrEqual(1024);
      chunks.push(chunk);
    } } finally { await reader.close(); }
    const result = Buffer.concat(chunks);
    expect(mode === "inflate-zlib" ? result : inflateSync(result)).toEqual(Buffer.from(plain));
  }
});

it("exposes bounded synchronous steps with explicit framing and cleanup", async () => {
  const { createByteCodec } = await import("./index.js");
  const { deflateSync, deflateRawSync, gzipSync } = await import("node:zlib");
  const plain = new TextEncoder().encode("portable".repeat(10000));
  for (const [format, encoded] of [["raw", deflateRawSync(plain)], ["zlib", deflateSync(plain)], ["gzip", gzipSync(plain)]] as const) {
    const codec = createByteCodec({ direction: "decode", format, chunkSize: 1024 });
    const chunks: Uint8Array[] = [];
    try {
      for (let at = 0; at < encoded.length; at += 7) {
        for (const chunk of codec.push(encoded.subarray(at, at + 7), at + 7 >= encoded.length)) {
          expect(chunk.length).toBeLessThanOrEqual(1024);
          chunks.push(chunk);
        }
      }
      expect(codec.complete).toBe(true);
    } finally { codec.close(); }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(plain));
    expect(() => [...codec.push(encoded, true)]).toThrow("closed");
  }
});

it("applies backpressure to larger-than-window compressed input and closes cancelled readers", async () => {
  const { deflateSync } = await import("node:zlib");
  const { defaultRuntime } = await import("./index.js");
  const bytes = new Uint8Array(256 * 1024);
  let state = 123456789;
  for (let i = 0; i < bytes.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    bytes[i] = state & 255;
  }
  const encoded = deflateSync(bytes);
  expect(encoded.length).toBeGreaterThan(64 * 1024);
  let checkpoints = 0;
  const { codec, CodecReader } = createCompressionCodec({
    ...defaultRuntime,
    async yieldTurn(abort) { abort.throwIfAborted(); checkpoints++; }
  });
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let pulled = 0; let closed = 0; let offset = 0;
    const reader = new CodecReader((async function* () {
      try {
        for (let at = 0; at < encoded.length; at += 4096) {
          pulled++;
          yield encoded.subarray(at, at + 4096);
        }
      } finally { closed++; }
    })(), controller.signal);
    const output = codec(reader, { mode: "inflate-zlib", chunkSize: 1024 }, controller.signal)[Symbol.asyncIterator]();
    try {
      const first = await output.next();
      expect(first.done).toBe(false);
      expect(first.value).toEqual(bytes.subarray(0, 1024));
      offset += first.value!.length;
      const paused = pulled;
      await Promise.resolve();
      expect(pulled).toBe(paused);
      expect(pulled).toBeLessThan(3);
      if (cancel) {
        const reason = new Error("stop");
        controller.abort(reason);
        await expect(output.next()).rejects.toBe(reason);
      } else {
        for (;;) {
          const next = await output.next();
          if (next.done) break;
          expect(next.value.length).toBeLessThanOrEqual(1024);
          expect(next.value).toEqual(bytes.subarray(offset, offset + next.value.length));
          offset += next.value.length;
        }
        expect(offset).toBe(bytes.length);
      }
    } finally { await output.return?.(); await reader.close(); }
    expect(closed).toBe(1);
  }
  expect(checkpoints).toBeGreaterThan(0);
});

it("distinguishes frames and rejects malformed or truncated byte streams", async () => {
  const { createByteCodec, transformBytes } = await import("./index.js");
  const { deflateSync, deflateRawSync, gzipSync } = await import("node:zlib");
  const plain = new TextEncoder().encode("format validation");
  for (const [format, encoded] of [["raw", deflateRawSync(plain)], ["zlib", deflateSync(plain)], ["gzip", gzipSync(plain)]] as const) {
    expect(transformBytes(encoded, { direction: "decode", format })).toEqual(plain);
    expect(() => transformBytes(encoded.subarray(0, encoded.length - 1), { direction: "decode", format })).toThrow("unexpected end");
    for (const other of ["raw", "zlib", "gzip"] as const) {
      if (other !== format) expect(() => transformBytes(encoded, { direction: "decode", format: other })).toThrow();
    }
    const decoder = createByteCodec({ direction: "decode", format, chunkSize: 1 });
    for (const chunk of decoder.push(encoded, true)) { expect(chunk.length).toBe(1); break; }
    expect(() => [...decoder.push(encoded, true)]).toThrow("closed");
    decoder.close();
  }
});

it("encodes all byte formats interoperably with the platform zlib implementation", async () => {
  const { transformBytes } = await import("./index.js");
  const { inflateSync, inflateRawSync, gunzipSync } = await import("node:zlib");
  const input = new TextEncoder().encode("independent byte encoding".repeat(4096));
  for (const [format, decode] of [["raw", inflateRawSync], ["zlib", inflateSync], ["gzip", gunzipSync]] as const) {
    const encoded = transformBytes(input, { direction: "encode", format, chunkSize: 1024 });
    expect(decode(encoded)).toEqual(Buffer.from(input));
  }
});

it("rejects string paths instead of resolving them through ambient filesystem access", async () => {
  const { codec, CodecReader } = createCompressionCodec();
  const reader = new CodecReader("/host-only/input.gz" as unknown as AsyncIterable<Uint8Array>, signal);
  try {
    await expect(async () => {
      for await (const bytes of codec(reader, { mode: "gunzip" }, signal)) void bytes;
    }).rejects.toThrow("Expected byte chunks");
  } finally { await reader.close(); }
});

it("requires explicit byte direction and framing, and keeps compatibility decoding opt-in", async () => {
  const { createByteCodec } = await import("./index.js");
  for (const options of [{ direction: "decode" }, { direction: "decode", format: "toString" }, { direction: "guess", format: "zlib" }, { direction: "encode", format: "zlib-or-gzip" }]) {
    expect(() => createByteCodec(options as Parameters<typeof createByteCodec>[0])).toThrow();
  }
});

it("single-member gzip rejects every trailing byte across chunk boundaries", async () => {
  const { gzipSync } = await import("node:zlib");
  const member = new Uint8Array(gzipSync("value"));
  const { codec, CodecReader } = createCompressionCodec();
  for (const split of [false, true]) for (const tail of [new Uint8Array(), Uint8Array.of(0), Uint8Array.of(65), member]) {
    const source = (async function* () {
      if (split) { yield member; yield tail; }
      else { const bytes = new Uint8Array(member.length + tail.length); bytes.set(member); bytes.set(tail, member.length); yield bytes; }
    })();
    const reader = new CodecReader(source, signal);
    const run = async () => {
      let output = "";
      try { for await (const bytes of codec(reader, { mode: "gunzip", chunkSize: 2, singleMember: true }, signal)) output += new TextDecoder().decode(bytes); }
      finally { await reader.close(); }
      return output;
    };
    if (tail.length) await expect(run()).rejects.toThrow();
    else expect(await run()).toBe("value");
  }
});
