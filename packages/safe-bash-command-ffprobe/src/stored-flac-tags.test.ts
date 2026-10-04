import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";

function fixture(groups: string[][]) {
  const encoder = new TextEncoder();
  const join = (parts: Uint8Array[]) => { const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result; };
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const info = new Uint8Array(34); new DataView(info.buffer).setBigUint64(10, (48000n << 44n) | (1n << 41n) | (15n << 36n) | 96000n);
  const blocks = [info, ...groups.map(group => join([u32(0), u32(group.length), ...group.flatMap(text => { const bytes = encoder.encode(text); return [u32(bytes.length), bytes]; })]))];
  return join([encoder.encode("fLaC"), ...blocks.flatMap((bytes, i) => [Uint8Array.of((i ? 4 : 0) | (i === blocks.length - 1 ? 128 : 0), bytes.length >>> 16, bytes.length >>> 8 & 255, bytes.length & 255), bytes]), new Uint8Array(100000)]);
}
async function run(bytes: Uint8Array, writer: string, route: "retained" | "stream" | "stdin", extra: string[] = [], fallback = false) {
  const base = new MemoryFileSystem(); await base.writeFile("/input.flac", bytes);
  let output = "", closed = false, opened = 0, retired = 0; const decoder = new TextDecoder();
  const capabilities = { ...base.capabilities, retainedRead: route === "retained", streamingRead: route !== "retained" };
  async function* chunks() { const borrowed = new Uint8Array(8191); try { for (let at = 0; at < bytes.length; at += borrowed.length) { const size = Math.min(borrowed.length, bytes.length - at); borrowed.set(bytes.subarray(at, at + size)); yield borrowed.subarray(0, size); } } finally { closed = true; } }
  const fs = new Proxy(base, { get(target, key) {
    if (key === "capabilities") return capabilities; if (key === "capabilitiesFor") return async () => capabilities;
    if (key === "readFile") return () => { throw new Error("buffered input forbidden"); }; if (key === "readStream") return () => chunks();
    if (key === "openReadFile") return async () => ({ stat: () => base.stat("/input.flac"), async read(offset: number, length: number) { expect(length).toBeLessThanOrEqual(16384); return bytes.slice(offset, offset + length); }, async close() { closed = true; } });
    if (key === "open") return async (...args: Parameters<typeof base.open>) => { const handle = await base.open(...args); opened++; return new Proxy(handle, { get(resource, name) { if (name === "close") return async () => { retired++; await handle.close(); }; const value = Reflect.get(resource, name, resource); return typeof value === "function" ? value.bind(resource) : value; } }); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const args = ["-of", writer, ...extra, route === "stdin" ? "-" : "/input.flac"];
  const result = await createFfprobeCommand({ limits: { maxOutputBytes: 4000000 } }).execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: route === "stdin" ? chunks() : { async *[Symbol.asyncIterator]() {} }, stdout: { async write(chunk) { expect(closed).toBe(true); expect(opened).toBe(retired); output += decoder.decode(chunk, { stream: true }); } }, stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  output += decoder.decode(); expect(result.exitCode).toBe(0); expect(output).toBe(fallback ? evalSyncFfprobe(bytes, args, () => bytes) : probe(bytes, args)); expect(opened).toBe(retired);
  expect(await base.readdir("/")).toEqual([{ name: "input.flac", type: "file" }]);
}
for (const route of ["retained", "stream", "stdin"] as const) for (const writer of ["json", "default", "flat", "compact", "csv"]) {
  it(`stores FLAC keys and values with ${writer} via ${route}`, async () => {
    const bytes = fixture([["TITLE=first", "TITLE=", "TITLE=second", "DESCRIPTION=note", "COMMENT=other", "2=two", "1=one", "03=three", "ß=upper", "SS=duplicate", "BOM=\ufeffvalue", "ZERO=\0 keep  ", "EMPTY=", "EMPTY=new"], ["TITLE=replaced", "NEW=last"]]);
    await run(bytes, writer, route);
  });
}
it("spills long normalized keys, values and many key records", async () => {
  const bytes = fixture([["ß".repeat(80000) + "=" + "🙂\n\"".repeat(30000), ...Array.from({ length: 1500 }, (_, i) => `field${i}=value${i}`)]]);
  await run(bytes, "json", "retained");
});
it("preserves tag selection and configured separators", async () => {
  const bytes = fixture([["TITLE=one,two", "ARTIST=artist", "CUSTOM=more"]]);
  for (const writer of ["json", "csv:s=,", "compact:s=||", "default:nk=1:nw=1", "flat"]) await run(bytes, writer, "retained", ["-show_entries", "format_tags=title,CUSTOM"]);
});

it("keeps colliding normalized key hashes distinct across replacements", async () => {
  const bytes = fixture([["DIIGCEHWRH=first", "OTGHCXXXUZ=second", "DIIGCEHWRH=third"], ["OTGHCXXXUZ=replaced"]]);
  await run(bytes, "json", "retained");
});

it("keeps the media fallback when strict FLAC validation rejects the input", async () => {
  const bytes = fixture([["TITLE=valid tag before later failure"]]);
  // Declare a truncated comment block after its valid entry.
  bytes[45] = bytes[45]! + 1;
  for (const route of ["retained", "stream", "stdin"] as const) await run(bytes, "json", route, [], true);
});
it("preserves surrogate pairs across stored-key page boundaries", async () => {
  const key = "A" + "😀".repeat(10000), bytes = fixture([[key + "=value"]]);
  await run(bytes, "json", "retained");
  await run(bytes, "flat", "retained", ["-show_entries", "format_tags=" + key]);
});
