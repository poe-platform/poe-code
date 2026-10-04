import { expect, it } from "vitest";
import { sniffWavStream } from "./stream-input.js";

for (const length of [0, 2, 12, 100]) it(`replays all ${length} bytes of an unknown stream with borrowed chunks`, async () => {
  const expected = Uint8Array.from({ length }, (_, i) => i + 1), borrowed = new Uint8Array(7), admitted: number[] = [];
  let closed = false;
  async function* source() { try {
    for (let offset = 0; offset < length; offset += borrowed.length) {
      borrowed.fill(255); const part = expected.subarray(offset, offset + borrowed.length); borrowed.set(part); yield borrowed.subarray(0, part.length);
    }
  } finally { closed = true; } }
  const result = await sniffWavStream(source(), new AbortController().signal, total => admitted.push(total));
  expect(result.wav).toBe(false);
  const actual: number[] = [];
  for await (const chunk of result.stream) actual.push(...chunk);
  expect(actual).toEqual([...expected]); expect(closed).toBe(true);
  if (length) { expect(admitted.at(-1)).toBe(length); expect(admitted.every((v, i) => i === 0 || v > admitted[i - 1]!)).toBe(true); }
});

it("closes the borrowed source if cancellation arrives between sniffing and replay", async () => {
  const controller = new AbortController(); let closed = false;
  async function* source() { try { yield new TextEncoder().encode("RIFF1234WAVEtail"); yield new Uint8Array(3); } finally { closed = true; } }
  const result = await sniffWavStream(source(), controller.signal, () => {});
  controller.abort(new Error("cancelled between phases"));
  await expect(result.stream.next()).rejects.toThrow("cancelled between phases"); expect(closed).toBe(true);
});

it("does not request another chunk until the replay consumer resumes", async () => {
  let calls = 0;
  async function* source() { calls++; yield new Uint8Array(100); calls++; yield new Uint8Array(100); }
  const { stream } = await sniffWavStream(source(), new AbortController().signal, () => {});
  expect(calls).toBe(1); expect((await stream.next()).value?.length).toBe(12); expect(calls).toBe(1);
  expect((await stream.next()).value?.length).toBe(88); expect(calls).toBe(1);
  await stream.next(); expect(calls).toBe(2); await stream.return();
});

it("holds upstream while caller-backed storage is applying backpressure", async () => {
  const { MemoryFileSystem } = await import("@poe-code/safe-fs/core");
  const { withStagedProbeSource } = await import("./stream-input.js");
  const base = new MemoryFileSystem();
  let release!: () => void, started!: () => void, reads = 0, first = true;
  const held = new Promise<void>(resolve => { release = resolve; }), writing = new Promise<void>(resolve => { started = resolve; });
  const fs = new Proxy(base, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof base.open>) => {
      const handle = await base.open(...args);
      return new Proxy(handle, { get(resource, name) {
        if (name === "write") return async (...values: Parameters<typeof handle.write>) => { if (first) { first = false; started(); await held; } return handle.write(...values); };
        const value = Reflect.get(resource, name, resource); return typeof value === "function" ? value.bind(resource) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  async function* input() { for (let i = 0; i < 10; i++) { reads++; yield new Uint8Array(16384); } }
  const pending = withStagedProbeSource({ fs, cwd: "/", env: {}, signal: new AbortController().signal }, input(), async source => source.size);
  await writing; const before = reads;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(reads).toBe(before); expect(reads).toBeLessThan(10);
  release(); expect(await pending).toBe(163840); expect(await base.readdir("/")).toEqual([]);
});
