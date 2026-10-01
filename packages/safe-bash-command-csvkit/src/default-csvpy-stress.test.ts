import {afterEach, expect, test, vi} from "vitest";
import {createDefaultCsvpyInterpreter} from "./default-csvpy.js";
import type {CsvpyConvertedInput} from "./contracts.js";

vi.mock("../dist/python-worker-source.js", () => ({source: "mocked guest"}));
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

const input: CsvpyConvertedInput = {
  mode: "reader", settings: {}, reader: async () => [][Symbol.iterator](),
  table: async () => {throw Error("unexpected table acquisition");},
  retainOutput() {}, async write() {}
};
const work = {limit: Infinity, consume() {}};

test("worker termination precedes draining an aborted input and observes its late failure", async () => {
  let nextEntered!: () => void;
  const entered = new Promise<void>(resolve => {nextEntered = resolve;});
  let failRead!: (reason: unknown) => void;
  const pendingRead = new Promise<IteratorResult<Uint8Array>>((_, reject) => {failRead = reject;});
  const terminated = vi.fn();
  const returned = vi.fn(async () => ({done: true as const, value: undefined}));
  class Worker {
    onmessage?: (event: {data: unknown}) => void;
    postMessage() {queueMicrotask(() => this.onmessage?.({data: {type: "io", channel: "stdin", size: 65536, work: 0}}));}
    terminate = terminated;
  }
  vi.stubGlobal("Worker", Worker);
  const controller = new AbortController();
  const provider = createDefaultCsvpyInterpreter({stdin: {[Symbol.asyncIterator]: () => ({next() {nextEntered(); return pendingRead;}, return: returned})}});
  const session = await provider.loadConverted!(input, controller.signal, work);
  const running = session.interact("test", controller.signal);
  const settled = expect(running).rejects.toThrow("cancelled");
  await entered;
  controller.abort(new Error("cancelled"));
  expect(terminated).toHaveBeenCalledOnce();
  failRead(new Error("late input failure"));
  await settled;
  await session.close();
  expect(terminated).toHaveBeenCalledOnce();
  expect(returned).toHaveBeenCalledOnce();
});

test("a failed browser worker construction releases its object URL", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  class Worker {constructor() {throw Error("worker unavailable");}}
  vi.stubGlobal("Worker", Worker);
  const controller = new AbortController();
  const session = await createDefaultCsvpyInterpreter().loadConverted!(input, controller.signal, work);
  await expect(session.interact("test", controller.signal)).rejects.toThrow("worker unavailable");
  await session.close();
  expect(revoke).toHaveBeenCalledOnce();
});

function installStreamWorker(script: (exchange: (channel: "stdin" | "stdout" | "stderr", bytes?: Uint8Array) => Promise<Uint8Array>) => Promise<void>): void {
  class Worker {
    onmessage?: (event: {data: unknown}) => void;
    onerror?: (error: unknown) => void;
    postMessage({shared}: {shared: SharedArrayBuffer}) {
      const state = new Int32Array(shared, 0, 2);
      const transfer = new Uint8Array(shared, 8);
      const exchange = async (channel: "stdin" | "stdout" | "stderr", bytes?: Uint8Array): Promise<Uint8Array> => {
        Atomics.store(state, 0, 0);
        if (bytes) transfer.set(bytes);
        await new Promise<void>(resolve => {
          const notify = vi.spyOn(Atomics, "notify").mockImplementation((...args) => {
            notify.mockRestore();
            const result = Atomics.notify(...args);
            resolve();
            return result;
          });
          this.onmessage?.({data: {type: "io", channel, size: bytes?.length ?? transfer.length, work: 0}});
        });
        expect(Atomics.load(state, 0)).toBe(1);
        return transfer.slice(0, Atomics.load(state, 1));
      };
      void script(exchange).then(() => this.onmessage?.({data: {type: "done", exitCode: 0, work: 0}})).catch(error => this.onerror?.(error));
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", Worker);
}

test("text-only output flushes incomplete UTF-8 on both streams at guest exit", async () => {
  installStreamWorker(async exchange => {
    await exchange("stdout", Uint8Array.of(0xc3));
    await exchange("stderr", Uint8Array.of(0xe2, 0x82));
  });
  const writes: [string, string][] = [];
  const signal = new AbortController().signal;
  const session = await createDefaultCsvpyInterpreter().loadConverted!({...input, async write(text, channel) {writes.push([text, channel]);}}, signal, work);
  expect(await session.interact("test", signal)).toBe(0);
  expect(writes).toEqual([["\ufffd", "stdout"], ["\ufffd", "stderr"]]);
});

test("byte output preserves incomplete UTF-8 without text conversion", async () => {
  installStreamWorker(async exchange => {await exchange("stdout", Uint8Array.of(0xc3));});
  const writes: [number[], string][] = [];
  const converted = {...input,
    async write() {throw Error("unexpected text conversion");},
    async writeBytes(bytes: Uint8Array, channel: "stdout" | "stderr") {writes.push([[...bytes], channel]);}
  };
  const signal = new AbortController().signal;
  const session = await createDefaultCsvpyInterpreter().loadConverted!(converted, signal, work);
  expect(await session.interact("test", signal)).toBe(0);
  expect(writes).toEqual([[[0xc3], "stdout"]]);
});

test("terminal lines receive exactly one newline, including empty lines", async () => {
  const received: string[] = [];
  installStreamWorker(async exchange => {
    for (let count = 0; count < 4; count++) received.push(new TextDecoder().decode(await exchange("stdin")));
  });
  const lines = ["print(1)", "print(2)\n", "", null];
  const signal = new AbortController().signal;
  const session = await createDefaultCsvpyInterpreter({terminal: {async readLine() {return lines.shift() ?? null;}}}).loadConverted!(input, signal, work);
  expect(await session.interact("test", signal)).toBe(0);
  expect(received).toEqual(["print(1)\n", "print(2)\n", "\n", ""]);
});
