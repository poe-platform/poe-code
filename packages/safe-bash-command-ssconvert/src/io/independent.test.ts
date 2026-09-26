import { expect, it } from "vitest";
import { createResourceIO } from "./index.js";
import type { ByteSource } from "../contracts.js";

const filesystem = { async read() { return []; }, async write() {} };

it("does not acquire descriptor iterators before consumption or for aborted opens", async () => {
  let acquisitions = 0;
  const source: ByteSource = { [Symbol.iterator]() { acquisitions++; return [new Uint8Array([9])][Symbol.iterator](); } };
  const io = createResourceIO({ cwd: "/", filesystem, descriptors: { 0: { source } } });
  expect(acquisitions).toBe(0);
  const controller = new AbortController();
  controller.abort("cancelled");
  await expect(io.read("fd://0", controller.signal)).rejects.toBe("cancelled");
  expect(acquisitions).toBe(0);
  const bytes = await io.read("fd://0", new AbortController().signal);
  expect(acquisitions).toBe(0);
  for await (const chunk of bytes) expect([...chunk]).toEqual([9]);
  expect(acquisitions).toBe(1);
});

it("keeps a borrowed descriptor cursor after a consumer stops early", async () => {
  let closed = false;
  const source = (async function* () { try { yield new Uint8Array([1]); yield new Uint8Array([2]); } finally { closed = true; } })();
  const io = createResourceIO({ cwd: "/", filesystem, descriptors: { 4: { source } } });
  const signal = new AbortController().signal;
  for await (const chunk of await io.read("fd://4", signal)) { expect([...chunk]).toEqual([1]); break; }
  expect(closed).toBe(false);
  const second: number[] = [];
  for await (const chunk of await io.read("fd://4", signal)) second.push(...chunk);
  expect(second).toEqual([2]);
  expect(closed).toBe(true);
});

it("checks cancellation during adapter consumption and closes its owned iterator", async () => {
  const controller = new AbortController();
  let closed = false;
  const io = createResourceIO({ cwd: "/", filesystem, adapters: { data: {
    async read() { return (async function* () { try { yield new Uint8Array([1]); controller.abort("stop"); yield new Uint8Array([2]); } finally { closed = true; } })(); },
    async write() {}
  } } });
  const read = async () => { const values: number[] = []; for await (const chunk of await io.read("data:binary", controller.signal)) values.push(...chunk); return values; };
  await expect(read()).rejects.toBe("stop");
  expect(closed).toBe(true);
});

it("does not dispatch credential-bearing or non-network redirect targets", async () => {
  for (const redirect of ["https://secret:password@other.test/a", "file:///host/private", "fd://0"]) {
    const events: string[] = [];
    const io = createResourceIO({ cwd: "/", filesystem, transport: {
      redirects: 1,
      async authorize(uri) { events.push(`allow ${uri}`); },
      async request(uri) { events.push(`request ${uri}`); return { redirect }; }
    } });
    await expect(io.read("https://public.test/a", new AbortController().signal)).rejects.toThrow("capability denied");
    expect(events).toEqual(["allow https://public.test/a", "request https://public.test/a"]);
  }
});

it("waits for descriptor sink backpressure and preserves an abort reason after settlement", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const controller = new AbortController();
  const bytes = new Uint8Array([0, 255, 128]);
  let received: Uint8Array | undefined;
  const io = createResourceIO({ cwd: "/", filesystem, descriptors: { 1: { sink: {
    async write(chunk) { received = chunk; await pending; }
  } } } });
  let settled = false;
  const writing = io.write("fd://1", bytes, controller.signal).finally(() => { settled = true; });
  await Promise.resolve();
  expect(received).toBe(bytes);
  expect(settled).toBe(false);
  const reason = { cancelled: true };
  controller.abort(reason);
  release();
  await expect(writing).rejects.toBe(reason);
});

it("keeps empty fd input distinct from a literal dash filename", async () => {
  const names: string[] = [];
  const io = createResourceIO({ cwd: "/work", descriptors: { 0: { source: [] } }, filesystem: {
    async read(name) { names.push(name); return [new Uint8Array([45])]; },
    async write() {}
  } });
  const signal = new AbortController().signal;
  const empty: number[] = [];
  for await (const chunk of await io.read("fd://0", signal)) empty.push(...chunk);
  expect(empty).toEqual([]);
  for await (const chunk of await io.read("-", signal)) expect([...chunk]).toEqual([45]);
  expect(names).toEqual(["/work/-"]);
});

it("uses native file URI authority and query rules without decoding encoded separators", async () => {
  const names: string[] = [];
  const io = createResourceIO({ cwd: "/work", filesystem: {
    async read(name) { names.push(name); return []; }, async write() {}
  } });
  const signal = new AbortController().signal;
  for (const uri of ["file://foreign/work/a?ignored.csv", "FILE:///work/a#fragment", "file:/work/a"])
    await io.read(uri, signal);
  expect(names).toEqual(["/work/a", "/work/a", "/work/a"]);
  await io.read("file:///work/a\\x.csv", signal);
  await io.read("file:///work/a%5Cx.csv", signal);
  expect(names.slice(3)).toEqual(["/work/a\\x.csv", "/work/a\\x.csv"]);
  for (const uri of ["file:///work/a%2Fb", "file:///work/a%2fb", "file:///work/a%00b", "file:///work/a%xx", "file:input.csv", "file://input.csv", "file:", "unknown://resource", "fd://0/x"])
    await expect(io.read(uri, signal)).rejects.toThrow(/^E Operation not supported$/);
  expect(names).toHaveLength(5);
  await expect(io.read("fd://97", signal)).rejects.toThrow(/^E Unable to read from fd:\/\/97$/);
});

it("reports decoded native VFS paths while preserving opaque failures", async () => {
  const opaque = { failed: true };
  const io = createResourceIO({ cwd: "/work", filesystem: {
    async read(name) { if (name === "/work/opaque") throw opaque; throw { code: "ENOENT" }; },
    async write() { throw { code: "EACCES" }; }
  } });
  const signal = new AbortController().signal;
  await expect(io.read("file://other/work/a%20b?query", signal)).rejects.toThrow("E /work/a b: No such file or directory");
  await expect(io.write("file://other/work/a%20b#fragment", new Uint8Array(), signal)).rejects.toThrow("E Can't open 'file:///work/a%20b' for writing: Permission denied");
  await expect(io.read("opaque", signal)).rejects.toBe(opaque);
});
