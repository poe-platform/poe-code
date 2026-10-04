import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeWav, probeWavSource } from "@poe-code/audio-ast";
import { WavTags } from "./wav-tags.js";
import { formatTaggedAudio } from "./tag-format.js";
import { probe } from "./probe.js";

function input(entries: [string, string][]) {
  const pcm = encodeWav({ sampleRate: 8000, channels: [new Float64Array(3)] });
  const chunks = entries.map(([id, text]) => {
    const value = new TextEncoder().encode(text), chunk = new Uint8Array(8 + value.length + value.length % 2);
    for (let i = 0; i < 4; i++) chunk[i] = id.charCodeAt(i);
    new DataView(chunk.buffer).setUint32(4, value.length, true); chunk.set(value, 8); return chunk;
  });
  const length = chunks.reduce((sum, c) => sum + c.length, 4), bytes = new Uint8Array(pcm.length + length + 8);
  bytes.set(pcm); bytes.set(new TextEncoder().encode("LIST"), pcm.length); new DataView(bytes.buffer).setUint32(pcm.length + 4, length, true);
  bytes.set(new TextEncoder().encode("INFO"), pcm.length + 8);
  let offset = pcm.length + 12; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true); return bytes;
}
const entries: [string, string][] = [["9999", "numeric last"], ["ZZZZ", "first"], ["ICRD", "mapped date"], ["1000", "numeric first"], ["date", "replacement date"], ["INAM", "\ufeff é😀\n\r\"\\nn||value\u2003\u00a0"], ["ZZZZ", "last\0ignored"], ["IART", "\t \n"]];
const roundtrip = (text: string) => new TextDecoder().decode(new TextEncoder().encode(text));

it("preserves every writer, field selection, numeric order and duplicate-tag semantics", async () => {
  const bytes = input(entries), fs = new MemoryFileSystem(), context = { fs, cwd: "/", env: {}, signal: new AbortController().signal };
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.slice(offset, offset + length); } }, tags = new WavTags(source, context);
  try {
    const audio = await probeWavSource(source, { onTag: span => tags.add(span) });
    for (const writer of ["json", "default", "default:nw=1:nk=1", "flat", "compact", "compact:s=||:nk=1:p=0", "compact:s=", "compact:s=n", "compact:s=\\", "csv", "csv:s=||:nk=0", "csv:s=:p=0"]) {
      for (const selection of [[], ["-show_format"], ["-show_streams", "-show_format"], ["-show_entries", "stream_tags:format_tags"], ["-show_entries", "stream=channels:format=tags,duration"], ["-show_entries", "stream_tags=title,date:format_tags=9999,ZZZZ"], ["-show_entries", "format_tags=missing"]]) {
        const args = ["-of", writer, ...selection, "input.wav"];
        let actual = ""; for await (const part of formatTaggedAudio(audio, bytes.length, args, tags)) actual += part;
        expect(roundtrip(actual), args.join(" ")).toBe(roundtrip(probe(bytes, args)));
      }
    }
  } finally { await tags.close(); }
  expect(await fs.readdir("/")).toEqual([]);
});

it("retains a large tag index with ordered updates in caller backing", async () => {
  const many: [string, string][] = Array.from({ length: 1500 }, (_, i) => ["k" + i.toString(36).padStart(3, "0"), "value " + i]);
  many.push(["k000", "updated"], ["k074", "changed"]);
  const bytes = input(many), base = new MemoryFileSystem(); let opened = 0;
  const fs = new Proxy(base, { get(target, key) { if (key === "open") return async (...args: Parameters<typeof base.open>) => { opened++; return base.open(...args); }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.slice(offset, offset + length); } };
  const tags = new WavTags(source, { fs, cwd: "/", env: {}, signal: new AbortController().signal });
  try {
    const audio = await probeWavSource(source, { onTag: span => tags.add(span) });
    const args = ["-of", "json", "-show_format", "input.wav"];
    let actual = ""; for await (const part of formatTaggedAudio(audio, bytes.length, args, tags)) actual += part;
    expect(actual).toBe(probe(bytes, args)); expect(tags.count).toBe(1500); expect(opened).toBe(1);
  } finally { await tags.close(); }
  expect(await base.readdir("/")).toEqual([]);
});
