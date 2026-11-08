import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {ExecutionContext} from "./execution.js";
import {readRetainedRtfDocument} from "./retained-rtf-document.js";
import {convert} from "./index.js";
const bytes = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0));
it("owns replayable wire output separately from embedded picture storage", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file reads forbidden"));
  try {
    const result = await readRetainedRtfDocument({bytes: bytes(String.raw`{\rtf1 before{\pict\pngblip 89504e470d0a1a0a}after}`)}, context, {fs, directory: "/", cacheBytes: 16384});
    expect(result.resources.count).toBe(1);
    let wire = ""; for await (const part of result.document.chunks()) wire += new TextDecoder().decode(part);
    expect(JSON.parse(wire).blocks[0].c[1]).toMatchObject({t: "Image", c: [expect.anything(), [], ["rtf-picture-1.png", ""]]});
    await result.document.close();
    const picture = await result.resources.get("rtf-picture-1.png"), payload: number[] = [];
    for await (const part of picture!.chunks()) payload.push(...part);
    expect(payload).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await result.resources.get("rtf-picture-01.png")).toBeUndefined();
    expect(await result.resources.get("rtf-picture-1.jpg")).toBeUndefined();
    await result.close();
    expect(await fs.readdir("/")).toEqual([]);
  } finally {await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it("serializes RTF semantics as the existing JSON writer does", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  const input = {bytes: bytes(String.raw`{\rtf1 text{\b bold}\par{\footnote note}}`)};
  try {
    const result = await readRetainedRtfDocument(input, context, {fs, directory: "/", cacheBytes: 16384});
    let wire = ""; for await (const part of result.document.chunks()) wire += new TextDecoder().decode(part);
    const expected = await convert([input], {from: "rtf", to: "json"}, {});
    expect(expected.kind).toBe("text");
    if (expected.kind === "text") expect(wire).toBe(expected.text);
    expect(result.resources.count).toBe(0);
    await result.close();
  } finally {await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it("retires every source and backing store when semantic conversion fails", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  let finalized = false;
  try {
    await expect(readRetainedRtfDocument({chunks: (async function* () {
      try {yield bytes(String.raw`{\rtf1{\object unsupported}}`);} finally {finalized = true;}
    })()}, context, {fs, directory: "/", cacheBytes: 16384})).rejects.toMatchObject({code: "E_CAPABILITY"});
    expect(finalized).toBe(true);
    expect(await fs.readdir("/")).toEqual([]);
  } finally {await context.close();}
});
