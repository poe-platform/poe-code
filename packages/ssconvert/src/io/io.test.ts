import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createResourceIO } from "./index.js";

it("resolves escaped file URIs and literal dash through injected VFS", async () => {
  const volume = Volume.fromJSON({ "/work/a #%.csv": "bytes", "/work/-": "dash" });
  const io = createResourceIO({ cwd: "/work", filesystem: {
    async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
    async write(path, bytes) { volume.writeFileSync(path, bytes); }
  } });
  const signal = new AbortController().signal;
  const read = async (name: string) => {
    const chunks = [];
    for await (const chunk of await io.read(name, signal)) chunks.push(...chunk);
    return new TextDecoder().decode(new Uint8Array(chunks));
  };
  expect(await read("file:///work/a%20%23%25.csv")).toBe("bytes");
  expect(await read("-")).toBe("dash");
  await io.write("../out.bin", new Uint8Array([0, 255]), signal);
  expect(volume.readFileSync("/out.bin")).toEqual(Buffer.from([0, 255]));
});

it("shares descriptor cursors, preserves binary bytes and awaits writes", async () => {
  let resumed = false;
  const fragment = new Uint8Array([0, 255]);
  const source = (async function* () { yield fragment; resumed = true; fragment.fill(1); })();
  const writes: number[][] = [];
  const io = createResourceIO({ cwd: "/", filesystem: {
    async read() { throw Error("unexpected VFS read"); }, async write() { throw Error("unexpected VFS write"); }
  }, descriptors: { 0: { source }, 7: { sink: { async write(bytes) { await Promise.resolve(); writes.push([...bytes]); } } } } });
  const signal = new AbortController().signal;
  const owned = [];
  for await (const chunk of await io.read("FD://00/", signal)) owned.push(new Uint8Array(chunk));
  expect(resumed).toBe(true);
  expect([...owned[0]!]).toEqual([0, 255]);
  const repeated = [];
  for await (const chunk of await io.read("fd://0", signal)) repeated.push(chunk);
  expect(repeated).toEqual([]);
  await io.write("fd://7", owned[0]!, signal);
  expect(writes).toEqual([[0, 255]]);
  await expect(io.read("fd://3", signal)).rejects.toThrow("Unable to read from fd://3");
});

it("authorizes each redirect and denies credentials before transport", async () => {
  const events: string[] = [];
  const io = createResourceIO({ cwd: "/", filesystem: {
    async read() { return []; }, async write() {}
  }, transport: {
    redirects: 2,
    async authorize(uri) { events.push(`authorize ${uri}`); if (uri.includes("denied")) throw Error("denied"); },
    async request(uri) { events.push(`request ${uri}`); return { redirect: "https://denied.test/data" }; }
  } });
  const signal = new AbortController().signal;
  await expect(io.read("https://allowed.test/data", signal)).rejects.toThrow("denied");
  expect(events).toEqual(["authorize https://allowed.test/data", "request https://allowed.test/data", "authorize https://denied.test/data"]);
  await expect(io.read("https://user:secret@allowed.test/data", signal)).rejects.toThrow("capability denied");
  expect(events).toHaveLength(3);
});

it("keeps capability-disabled HTTP a safety divergence and permits explicit VFS adapters", async () => {
  const events: string[] = [];
  const filesystem = { async read() { events.push("VFS"); return []; }, async write() {} };
  const signal = new AbortController().signal;
  const denied = createResourceIO({ cwd: "/", filesystem });
  await expect(denied.read("http://example.test/input", signal)).rejects.toMatchObject({ code: "capability-denied" });
  expect(events).toEqual([]);
  const allowed = createResourceIO({ cwd: "/", filesystem, adapters: { custom: {
    async read(uri) { events.push(uri); return [new Uint8Array([0, 255])]; },
    async write(uri, bytes) { events.push(`${uri}:${[...bytes].join(",")}`); }
  } } });
  for await (const bytes of await allowed.read("custom://host/input", signal)) expect([...bytes]).toEqual([0, 255]);
  await allowed.write("custom://host/output", new Uint8Array([0, 255]), signal);
  expect(events).toEqual(["custom://host/input", "custom://host/output:0,255"]);
});
