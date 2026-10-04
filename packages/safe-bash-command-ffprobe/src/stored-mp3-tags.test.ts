import { writeAudioMetadata } from "@poe-code/audio-ast";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";

function fixture(tags: Record<string,string>) {
  const audio = new Uint8Array(417 * 3); for (let i = 0; i < 3; i++) audio.set([255,251,144,0],i * 417);
  const tagged = writeAudioMetadata(audio, tags), bytes = new Uint8Array(tagged.length + 128); bytes.set(tagged);
  bytes.set(new TextEncoder().encode("TAGold title"),bytes.length-128);bytes[bytes.length-2]=7;bytes[bytes.length-1]=13;
  return bytes;
}
async function run(bytes: Uint8Array, writer: string, route: "retained" | "stream" | "stdin", extra: string[] = [], fallback = false) {
  const base = new MemoryFileSystem(); await base.writeFile("/input.mp3", bytes);
  let output = "", closed = false, opened = 0, retired = 0; const decoder = new TextDecoder();
  const capabilities = { ...base.capabilities, retainedRead: route === "retained", streamingRead: route !== "retained" };
  async function* chunks() { const borrowed = new Uint8Array(8191); try { for (let at = 0; at < bytes.length; at += borrowed.length) { const size = Math.min(borrowed.length, bytes.length - at); borrowed.set(bytes.subarray(at, at + size)); yield borrowed.subarray(0, size); } } finally { closed = true; } }
  const fs = new Proxy(base, { get(target, key) {
    if (key === "capabilities") return capabilities; if (key === "capabilitiesFor") return async () => capabilities;
    if (key === "readFile") return () => { throw new Error("buffered input forbidden"); }; if (key === "readStream") return () => chunks();
    if (key === "openReadFile") return async () => ({ stat: () => base.stat("/input.mp3"), async read(offset: number, length: number) { expect(length).toBeLessThanOrEqual(16384); return bytes.slice(offset, offset + length); }, async close() { closed = true; } });
    if (key === "open") return async (...args: Parameters<typeof base.open>) => { const handle = await base.open(...args); opened++; return new Proxy(handle, { get(resource, name) { if (name === "close") return async () => { retired++; await handle.close(); }; const value = Reflect.get(resource, name, resource); return typeof value === "function" ? value.bind(resource) : value; } }); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const args = ["-of", writer, "-show_streams", "-show_format", ...extra, route === "stdin" ? "-" : "/input.mp3"];
  const result = await createFfprobeCommand({ limits: { maxOutputBytes: 4000000 } }).execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: route === "stdin" ? chunks() : { async *[Symbol.asyncIterator]() {} }, stdout: { async write(chunk) { expect(closed).toBe(true); expect(opened).toBe(retired); output += decoder.decode(chunk, { stream: true }); } }, stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  output += decoder.decode(); expect(result.exitCode).toBe(0); expect(output).toBe(fallback ? evalSyncFfprobe(bytes, args, () => bytes) : probe(bytes, args)); expect(opened).toBe(retired);
  expect(await base.readdir("/")).toEqual([{ name: "input.mp3", type: "file" }]);
}
for (const route of ["retained", "stream", "stdin"] as const) for (const writer of ["json", "default", "flat", "compact", "csv"]) {
  it(`streams strict MP3 metadata and tags with ${writer} via ${route}`, async () => {
    await run(fixture({title:'  Écho😀, "Night"\n'.repeat(2000)+'\0ignored',artist:'artist',albumArtist:'album artist',comment:'note',TZZZ:'unknown'}),writer,route);
  });
}
it("spills MP3 tag records and preserves long canonical keys",async()=>{
  const tags:Record<string,string>={albumArtist:'first',title:'title'};
  for(let i=0;i<1500;i++)tags['T'+i.toString(36).padStart(3,'0')]='value'+i;
  await run(fixture(tags),'json','retained');
});
it("preserves configured writers, selected tags and malformed MPEG fallback",async()=>{
  const bytes=fixture({title:'one,two',artist:'artist'});
  for(const writer of ['json','csv:s=,','compact:s=||','default:nk=1:nw=1'])await run(bytes,writer,'retained',['-show_entries','format_tags=title,artist']);
  const broken=bytes.slice(0,-129);
  for(const route of ['retained','stream','stdin'] as const)await run(broken,'json',route,[],true);
});
it("preserves ffprobe's declared Xing byte-rate calculation", async()=>{
  const bytes=new Uint8Array(417*3);for(let i=0;i<3;i++)bytes.set([255,251,144,0],i*417);
  bytes.set(new TextEncoder().encode('Xing'),36);const view=new DataView(bytes.buffer);view.setUint32(40,3);view.setUint32(44,2);view.setUint32(48,1234);
  for(const route of ['retained','stream','stdin'] as const)await run(bytes,'json',route);
});
it("replays globally unsynchronized ID3v2.3 values through the stored index",async()=>{
  const data=Uint8Array.from([0,...Array.from({length:20000},(_,i)=>i%2?255:65)]),frame=new Uint8Array(10+data.length);
  frame.set(new TextEncoder().encode('TIT2'));new DataView(frame.buffer).setUint32(4,data.length);frame.set(data,10);
  const physical=Uint8Array.from(Array.from(frame).flatMap(byte=>byte===255?[255,0]:[byte])),length=physical.length;
  const bytes=new Uint8Array(10+length+417*2);bytes.set([73,68,51,3,0,128,length>>>21&127,length>>>14&127,length>>>7&127,length&127]);bytes.set(physical,10);
  for(let i=0;i<2;i++)bytes.set([255,251,144,0],10+length+i*417);
  for(const route of ['retained','stream','stdin'] as const)await run(bytes,'json',route);
});
