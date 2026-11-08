import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfFileSource } from "../source.js";
import { readStoredItems } from "./stored-record.js";
import type { PdfCosNode } from "../ast.js";
import { parseContentOperators } from "./operator-parser.js";
import { parseContentRangeOperators } from "./range-operator-parser.js";

async function fixture(text: string) {
  const bytes = new TextEncoder().encode(text);
  const reads = vi.fn(async (at: number, count: number) => bytes.slice(at, at + count));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const input = { capabilities: { retainedRead: true }, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), read: reads, close: async () => {},
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input", { chunkBytes: 16, cacheBytes: 32 });
  return { bytes, source, reads, storage: { fs, directory: "/scratch" }, async close() {
    expect(await fs.readdir("/scratch")).toEqual([]); await source.close();
  } };
}

// Spilling strips irrelevant formatting spans but preserves operand semantics.
function semantics(value: unknown): unknown {
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(semantics);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["span", "raw", "rawBytes", "encoding"].includes(key)).map(([key, item]) => [key, semantics(item)]));
  return value;
}

describe("retained content operators", () => {
  it.each(["BT /F2 /GS2 gs 5.711 Tf ET", "fff B*Bf* f5 Ts qq /Res1 DoQ", "BI /W 4 /H 1 /CS /G ID a EI EI Q", "BI /W 1 ID abc q Q", "[1 (ab) << /X true >>] TJ"])("shares buffered recovery for %s", async text => {
    const f = await fixture(text); const actual = [];
    for await (const operator of parseContentRangeOperators(f.source, f.storage)) actual.push(operator);
    expect(semantics(actual)).toEqual(semantics([...parseContentOperators(f.bytes)])); await f.close();
  });

  it("spills and restores excess operands in LIFO order, including after partial pops", async () => {
    const text = Array.from({ length: 160 }, (_, i) => `/F${i} q `).join("") + "Do ".repeat(70) + "/Latest q " + "Do ".repeat(91);
    const f = await fixture(text); const actual = [];
    for await (const operator of parseContentRangeOperators(f.source, f.storage, { chunkBytes: 32 })) actual.push(operator);
    expect(semantics(actual)).toEqual(semantics([...parseContentOperators(f.bytes)])); await f.close();
  });

  it("preserves nested operands and binary strings through spill and reload", async () => {
    const text = "[(a) <00ff> << /X [1 true null] >>] q ".repeat(40) + "TJ ".repeat(40);
    const f = await fixture(text); const actual = [];
    for await (const operator of parseContentRangeOperators(f.source, f.storage, { chunkBytes: 32 })) actual.push(operator);
    expect(semantics(actual)).toEqual(semantics([...parseContentOperators(f.bytes)])); await f.close();
  });

  it("cleans retained recovery runs when cancellation arrives between pulls", async () => {
    const f = await fixture("/F q ".repeat(100)); const controller = new AbortController();
    const iterator = parseContentRangeOperators(f.source, f.storage, { signal: controller.signal });
    for (let i = 0; i < 40; i++) await iterator.next();
    expect(await f.storage.fs.readdir("/scratch")).not.toEqual([]);
    controller.abort(new Error("stop recovery")); await expect(iterator.next()).rejects.toThrow("stop recovery");
    await f.close();
  });

  it("does not scan later content before the consumer advances and cleans early return", async () => {
    const f = await fixture("/F q ".repeat(70) + "q ".repeat(10000));
    const iterator = parseContentRangeOperators(f.source, f.storage, { chunkBytes: 32 });
    for (let i = 0; i < 70; i++) await iterator.next();
    expect(await f.storage.fs.readdir("/scratch")).not.toEqual([]);
    expect(Math.max(...f.reads.mock.calls.map(([at]) => at))).toBeLessThan(512);
    await iterator.return(); await f.close();
  });

  it.each([8192, 131072])("scans %i inline-image bytes using bounded generated reads", async length => {
    const prefix = new TextEncoder().encode("BI /F /DCT ID "); const suffix = new TextEncoder().encode(" EI Q");
    const size = prefix.length + length + suffix.length;
    let peakRead = 0;
    const fs = { capabilities: { retainedRead: true }, openReadFile: async () => ({
      stat: async () => ({ type: "file", size }), close: async () => {},
      read: async (at: number, count: number) => {
        peakRead = Math.max(peakRead, count);
        const result = new Uint8Array(Math.min(count, size - at));
        for (let i = 0; i < result.length; i++) {
          const position = at + i;
          result[i] = position < prefix.length ? prefix[position]! : position < prefix.length + length ? 128 : suffix[position - prefix.length - length]!;
        }
        return result;
      },
    }) } as unknown as FileSystem;
    const source = await PdfFileSource.open(fs, "/image", { chunkBytes: 4096, cacheBytes: 4096 });
    // No recovery spill is required; any attempted filesystem staging would fail.
    const iterator = parseContentRangeOperators(source, { fs, directory: "/scratch" });
    const image = (await iterator.next()).value!.inlineImage!;
    expect(image.start).toBe(prefix.length); expect(image.end - image.start).toBe(length);
    expect((await iterator.next()).value!.operator).toBe("Q"); expect((await iterator.next()).done).toBe(true);
    expect(peakRead).toBeLessThanOrEqual(4096); await source.close();
  });

  it("charges staging before writing and cleans up after admission failure", async () => {
    const f = await fixture("/F q ".repeat(100));
    await expect(async () => { for await (const ignored of parseContentRangeOperators(f.source, f.storage, { maxStagingBytes: 1 })) void ignored; }).rejects.toThrow("limit");
    await f.close();
  });

  it("honors cancellation and operand limits", async () => {
    const f = await fixture("[1 2 3] TJ");
    await expect(async () => { for await (const ignored of parseContentRangeOperators(f.source, f.storage, { maxNodes: 2 })) void ignored; }).rejects.toThrow("limit");
    const controller = new AbortController(); controller.abort(new Error("cancel operators"));
    await expect(async () => { for await (const ignored of parseContentRangeOperators(f.source, f.storage, { signal: controller.signal })) void ignored; }).rejects.toThrow("cancel operators");
    await f.close();
  });
});

// Only scalar run descriptors persist. Every stored byte is checked on write
// and regenerated on read, so this oracle cannot hide a payload in a RAM spool.
function externalStorage() {
  const scope = {};
  const record = new Uint8Array(10); record.set([47, 70]); new DataView(record.buffer).setFloat64(2, 2);
  type Run = { count: number; revision: number; identity: string };
  const live = new Map<string, Run>();
  let peakFiles = 0;
  let outstanding = 0;
  let peakWrite = 0;
  const stat = (run: Run): FileStat => ({ type: "file", size: run.count, identityScope: scope, opaqueIdentity: run.identity,
    revision: run.revision, mode: 0o600, mtimeMs: run.revision, ctimeMs: run.revision, atimeMs: 0 });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      const run = { count: 0, revision: 0, identity: path };
      live.set(path, run); peakFiles = Math.max(peakFiles, live.size);
      return { file: { path, stat: stat(run) }, cleanup: { remove: async () => { live.delete(path); }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) {
          outstanding += bytes.length; peakWrite = Math.max(peakWrite, outstanding);
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(32);
          await Promise.resolve();
          for (const byte of bytes) { expect(byte).toBe(record[run.count % record.length]); run.count++; }
          run.revision++; outstanding -= bytes.length;
        }, finish: async () => stat(run),
      } };
    },
    async openReadFile(path: string) {
      const run = live.get(path)!;
      return { stat: async () => stat(run), close: async () => {}, async read(position: number, length: number) {
        expect(length).toBeLessThanOrEqual(32);
        const bytes = new Uint8Array(Math.min(length, run.count - position));
        for (let at = 0; at < bytes.length; at++) bytes[at] = record[(position + at) % record.length]!;
        return bytes;
      } };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as FileSystem;
  return { fs, directory: "/authorized", live, get peakFiles() { return peakFiles; }, get peakWrite() { return peakWrite; } };
}


describe("content recovery with generated external storage", () => {
  it.each([65, 513, 2049])("recovers %i operands without retaining the spill payload", async count => {
    const f = await fixture("/F q ".repeat(count) + "Do ".repeat(count));
    const storage = externalStorage(); let recovered = 0;
    for await (const op of parseContentRangeOperators(f.source, storage, { chunkBytes: 32 })) {
      if (op.operator === "Do") { expect(op.operands[0]).toMatchObject({ kind: "name", decoded: "F" }); recovered++; }
    }
    expect(recovered).toBe(count); expect(storage.peakFiles).toBeLessThanOrEqual(9);
    expect(storage.peakWrite).toBeLessThanOrEqual(32); expect(storage.live.size).toBe(0); await f.close();
  });
});

it("keeps text bytes in caller backing through operand recovery", async () => {
  const text="("+"ab\\101".repeat(2048)+") q ";
  const f=await fixture(text.repeat(40)+"Tj ".repeat(40));
  const data=new Uint8Array(4*1024*1024);let end=0;
  const backing={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return data.subarray(at,at+n);},async write(at:number,bytes:Uint8Array){data.set(bytes,at);}};
  let count=0;
  for await(const op of parseContentRangeOperators(f.source,f.storage,{pathStorage:backing})){
    if(op.operator!=="Tj")continue;
    const value=op.operands[0];
    expect(value?.kind).toBe("string");
    if(value?.kind!=="string")throw Error("Expected text");
    expect(value.bytes.length).toBe(0);
    const stored=(value as typeof value & {storedBytes?:{position:number;byteLength:number;storage:unknown}}).storedBytes!;
    expect(stored.storage).toBe(backing);
    expect(new TextDecoder().decode(data.subarray(stored.position,stored.position+stored.byteLength))).toBe("abA".repeat(2048));
    count++;
  }
  expect(count).toBe(40);await f.close();
});

it("keeps growing text-array elements in caller backing", async () => {
  const f=await fixture("["+"(A) -12 ".repeat(4096)+"] TJ");
  const data=new Uint8Array(4*1024*1024);let end=0;
  const backing={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return data.subarray(at,at+n);},async write(at:number,bytes:Uint8Array){data.set(bytes,at);}};
  try{
    const work=parseContentRangeOperators(f.source,f.storage,{pathStorage:backing});
    const op=(await work.next()).value!;
    expect(op.operator).toBe("TJ");
    const array=op.operands[0];if(array?.kind!=="array")throw Error("Expected array");
    expect(array.items).toHaveLength(0);
    expect(array.storedItems?.length).toBe(8192);
    let count = 0;
    for await (const item of readStoredItems<PdfCosNode>(array.storedItems!)) {
      expect(item.kind).toBe(count % 2 ? "number" : "string");
      if (item.kind === "number") expect(item.value).toBe(-12);
      else if (item.kind === "string") {
        expect(item.bytes).toHaveLength(0);
        expect(item.storedBytes?.storage).toBe(backing);
        expect(data[item.storedBytes!.position]).toBe(65);
      }
      count++;
    }
    expect(count).toBe(8192);
    await work.return();
  }finally{await f.close();}
});

it.each(["abort", "failure"])("preserves array-link write %s", async mode => {
  const f=await fixture("[(A) (B)] TJ"),controller=new AbortController(),failure={reason:"array backing"};
  const data=new Uint8Array(8192);let end=0;
  const backing={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return data.subarray(at,at+n);},async write(at:number,bytes:Uint8Array){data.set(bytes,at);if(bytes.length===8){if(mode==="abort")controller.abort(failure);else throw failure;}}};
  try{
    const work=parseContentRangeOperators(f.source,f.storage,{pathStorage:backing,signal:controller.signal});
    await expect(work.next()).rejects.toBe(failure);
  }finally{await f.close();}
});


it("keeps dash operands in caller backing instead of expanding them", async () => {
  const f = await fixture("[" + "1 2 ".repeat(4096) + "] 3 d");
  const data = new Uint8Array(4 * 1024 * 1024); let end = 0;
  const backing = { allocate(n: number) { const at = end; end += n; return at; },
    async read(at: number, n: number) { return data.subarray(at, at + n); },
    async write(at: number, bytes: Uint8Array) { data.set(bytes, at); } };
  try {
    for await (const op of parseContentRangeOperators(f.source, f.storage, { pathStorage: backing })) {
      const array = op.operands[0];
      expect(array?.kind).toBe("array");
      if (array?.kind !== "array") throw Error("Expected dash array");
      expect(array.items).toHaveLength(0);
      expect(array.storedItems?.length).toBe(8192);
    }
  } finally { await f.close(); }
});

it("keeps long numeric operand spellings bounded in compact mode",async()=>{
 const f=await fixture("0".repeat(4096)+"7.0 w");
 try{
  const iterator=parseContentRangeOperators(f.source,f.storage,{compactNumbers:true});
  const step=await iterator.next();expect(step.done).toBe(false);
  if(step.done)throw new Error("Missing operator");
  expect(step.value.operator).toBe("w");expect(step.value.operands[0]).toMatchObject({kind:"number",value:7,isInteger:false});
  const node=step.value.operands[0]!;expect(node.kind==="number"?node.raw!.length:Infinity).toBeLessThanOrEqual(2048);
  await iterator.return();
 }finally{await f.close();}
});

it("preserves operand recovery across long ignored keywords",async()=>{
 const f=await fixture("7 "+"z".repeat(8192)+" w qQ"),actual=[];
 try{
  for await(const op of parseContentRangeOperators(f.source,f.storage,{compactKeywords:true}))actual.push(op);
  expect(semantics(actual)).toEqual(semantics([...parseContentOperators(f.bytes)]));
 }finally{await f.close();}
});
