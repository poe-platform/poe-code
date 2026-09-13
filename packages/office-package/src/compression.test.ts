import { expect, it } from "vitest";
import { createCompressionCodec } from "./compression.js";

const block = Uint8Array.of(0x33, 0x34, 0x32, 0x36, 0x31, 0x35, 0x33, 0xb7, 0xb0, 0x04, 0x00);
const signal = new AbortController().signal;

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
