import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { replaceRetainedPdfName } from "./retained-name-replacement.js";

// Compatibility oracle deliberately follows the existing buffered string search.
function replace(content: string, oldName: string, newName: string) {
  const needle = `/${oldName}`; let out = "", at = 0;
  while (at < content.length) {
    const found = content.indexOf(needle, at); if (found < 0) return out + content.slice(at);
    const after = content[found + needle.length];
    out += content.slice(at, found) + (after === undefined || " \t\n\r/<>[]()".includes(after) ? `/${newName}` : needle);
    at = found + needle.length;
  }
  return out;
}

for (const chunkSize of [1, 3, 17]) it(`renames names with buffered semantics across ${chunkSize}-byte boundaries`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  for (const [text, oldName, newName] of [
    ["/F1 12 Tf (/F1) % /F1\n/F10 /F1#20 /F1\0 /F1\f /F1% /F1", "F1", "F1_qap1"],
    ["/a/a/b /a/b/a/b/ /a/a", "a/b", "renamed"],
    ["// /A / <//>", "", "empty"],
    ["/a a /a ab /a a/a a", "a a", "x"],
    ["/name /na\u0080me", "na\u0080me", "\u0101\ud800😀"],
    ["/unmatched", "unmatched-longer", "replacement"],
  ]) {
    const input = Uint8Array.from(text!, ch => ch.charCodeAt(0) & 255), actual: Uint8Array[] = [];
    async function* chunks() { for (let at = 0; at < input.length; at += chunkSize) yield input.subarray(at, at + chunkSize); }
    for await (const bytes of replaceRetainedPdfName(chunks(), oldName!, newName!, { fs, directory: "/scratch" }, { chunkBytes: 7 })) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(7); actual.push(bytes); }
    const expected = Uint8Array.from(replace(text!, oldName!, newName!).split(""), ch => ch.charCodeAt(0) & 255);
    expect(Buffer.concat(actual)).toEqual(Buffer.from(expected));
  }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("checks cancellation when a suspended final output resumes", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController();
  const output = replaceRetainedPdfName([new Uint8Array([65])], "Font", "Other", { fs, directory: "/scratch" }, { signal: controller.signal });
  expect((await output.next()).value).toEqual(new Uint8Array([65]));
  controller.abort(new Error("stopped"));
  await expect(output.next()).rejects.toThrow("stopped");
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("matches overlapping literal searches for deterministic generated inputs", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  let seed = 147;
  const random = (bound: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % bound; };
  const alphabet = "/ab \n";
  for (let sample = 0; sample < 180; sample++) {
    const name = Array.from({ length: random(8) }, () => alphabet[random(alphabet.length)]).join("");
    const text = Array.from({ length: random(90) }, () => alphabet[random(alphabet.length)]).join("") + `/${name}`;
    const actual: Uint8Array[] = [];
    for await (const bytes of replaceRetainedPdfName([Buffer.from(text)], name, "renamed", { fs, directory: "/scratch" }, { chunkBytes: 5 })) actual.push(bytes);
    expect(Buffer.concat(actual).toString()).toBe(replace(text, name, "renamed"));
  }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const failure of ["producer", "budget", "consumer"] as const) it(`closes the input and spilled backing after ${failure}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const name = "a".repeat(40000); let closed = false, reads = 0;
  async function* input() {
    try {
      reads++; yield Buffer.from(`/${name} `);
      if (failure === "producer") throw new Error("producer failed");
      reads++; yield Buffer.from("untouched");
    } finally { closed = true; }
  }
  const output = replaceRetainedPdfName(input(), name, "replaced", { fs, directory: "/scratch" }, { chunkBytes: 3, maxOutputBytes: failure === "budget" ? 2 : Infinity });
  if (failure === "consumer") {
    const first = (await output.next()).value!;
    expect(first).toEqual(new Uint8Array([47, 114, 101]));
    expect(reads).toBe(1);
    await output.return(undefined);
    expect(first).toEqual(new Uint8Array([47, 114, 101]));
  } else await expect(async () => { for await (const bytes of output) expect(bytes.byteLength).toBeLessThanOrEqual(3); }).rejects.toThrow(failure === "producer" ? "producer failed" : "output limit");
  expect(closed).toBe(true);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const length of [10000, 100000]) it(`uses generated external backing for a ${length}-unit name`, async () => {
  // This backend stores only a length. The slash followed by a's has an all-zero
  // fallback table, so spilled bytes can be validated and regenerated on demand.
  let size = 0, writes = 0, reads = 0, opened = 0, closed = 0, pending = 0, peak = 0;
  const stat = { type: "file", size: 0, identity: "table", revision: "v1" };
  const fs = {
    async stat() { return { ...stat, type: "directory" }; },
    async removeFileConditional() {},
    async open() {
      opened++;
      return {
        capabilities: { positionedRead: true, positionedWrite: true },
        async stat() { return stat; },
        async write(bytes: Uint8Array, position: number) {
          pending += bytes.byteLength; peak = Math.max(peak, pending);
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384);
          expect(bytes.every(byte => byte === 0)).toBe(true);
          await Promise.resolve();
          size = Math.max(size, position + bytes.byteLength); writes++; pending -= bytes.byteLength; return bytes.byteLength;
        },
        async read(bytes: Uint8Array, position: number) {
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384);
          expect(position + bytes.byteLength).toBeLessThanOrEqual(size);
          bytes.fill(0); reads++; return bytes.byteLength;
        },
        async close() { closed++; },
      };
    },
    async readFile() { throw new Error("whole read forbidden"); },
    async writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as Parameters<typeof replaceRetainedPdfName>[3]["fs"];
  const name = "a".repeat(length), chunks: Uint8Array[] = [];
  async function* input() {
    yield Uint8Array.of(47, 97, 98, 47);
    const block = new Uint8Array(100).fill(97);
    for (let count = 0; count < length - 100; count += 100) yield block;
    yield Uint8Array.of(98); // Force fallback to the earliest spilled prefix.
  }
  for await (const bytes of replaceRetainedPdfName(input(), name, "b", { fs, directory: "/scratch" }, { chunkBytes: 4096 })) chunks.push(bytes);
  expect(Buffer.concat(chunks).toString()).toBe(`/ab/${"a".repeat(length - 100)}b`);
  expect(opened).toBe(1); expect(closed).toBe(opened); expect(writes).toBeGreaterThan(0); expect(reads).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(16384); expect(pending).toBe(0);
});

for (const failure of ["write", "read", "cancel"] as const) it(`releases prefix handles after backing ${failure}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("backing failed"); let opened = 0, closed = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const descriptor = await fs.open!(...args); opened++;
      return { ...descriptor, capabilities: descriptor.capabilities, stat: descriptor.stat.bind(descriptor),
        async write(...writeArgs: Parameters<typeof descriptor.write>) {
          if (failure === "write") throw reason;
          if (failure === "cancel") controller.abort(reason);
          return descriptor.write(...writeArgs);
        },
        async read(...readArgs: Parameters<typeof descriptor.read>) {
          if (failure === "read") throw reason;
          return descriptor.read(...readArgs);
        },
        async close() { closed++; await descriptor.close(); },
      };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const output = replaceRetainedPdfName([Buffer.from("/ab")], "a".repeat(40000), "b", { fs: guarded, directory: "/scratch" }, { signal: controller.signal });
  await expect(async () => { for await (const ignoredBytes of output) { /* drain */ } }).rejects.toBe(reason);
  expect(opened).toBe(1); expect(closed).toBe(opened); expect(await fs.readdir("/scratch")).toEqual([]);
});
