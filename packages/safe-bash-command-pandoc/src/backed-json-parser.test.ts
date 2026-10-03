import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {BackedJson} from "./backed-json.js";
import {parseBackedJson} from "./backed-json-parser.js";
import {readJsonNumber} from "./json-number.js";

async function parse(input: string, chunkSize = 7, signal = new AbortController().signal, numbers = false): Promise<string> {
  const fs = new MemoryFileSystem();
  const context = new ExecutionContext("convert", {signal});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal}, 1);
  const index = new PagedStorage({fs, cwd: "/", env: {}, signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  try {
    await parseBackedJson((async function* () {
      for (let offset = 0; offset < input.length; offset += chunkSize) yield input.slice(offset, offset + chunkSize);
    })(), tree, index, units => context.cooperate(units), (offset, message) => {throw new Error(`${offset}: ${message}`);}, numbers ? async (node, offset) => {
      try {await readJsonNumber(tree.scalarChunks(node), units => context.cooperate(units));}
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        throw new Error(`${offset}: ${error.message}`);
      }
    } : undefined);
    let result = "";
    for await (const bytes of tree.chunks()) {
      expect(bytes.length).toBeLessThanOrEqual(16384);
      result += new TextDecoder().decode(bytes);
    }
    return result;
  } finally {
    await storage.close(); await index.close(); await context.close();
    expect(await fs.readdir("/")).toEqual([]);
  }
}

it.each([1, 7, 4096])("parses split tokens into caller-backed nodes (%i)", async size => {
  const input = String.raw`{"a":[null,true,false,-1.25e+2,0,0.001],"b":{"empty":[],"map":{},"s":"a\n\t\uD83D\uDE00\ud800x\udc00\\\"\/"}}`;
  expect(JSON.parse(await parse(input, size))).toEqual(JSON.parse(input));
});
it("spills large tokens and key indexes while keeping nested key scopes distinct", async () => {
  const object: Record<string, unknown> = {long: "x".repeat(100000)};
  for (let index = 0; index < 1000; index++) object[`key${index}`] = {same: index};
  expect(JSON.parse(await parse(JSON.stringify(object), 4096))).toEqual(object);
});
it("parses deep nesting without a resident parser stack", async () => {
  const input = "[".repeat(1500) + "null" + "]".repeat(1500);
  expect(await parse(input, 4096)).toBe(input);
});
it.each([
  "", " ", "[", "{", "[1,]", '{"a":1,}', '{"a" 1}', "[1 2]", "{}[]", "truex",
  "+1", "01", "1.", "1e", "1e+", "--1", '"\\x"', '"\\u12"', '"\u0000"', '"unterminated',
  '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"key":1,"key":2}}'
])("rejects malformed or duplicate-key JSON: %s", async input => {
  await expect(parse(input, 1)).rejects.toThrow();
});
it("does not collect arbitrarily long numeric tokens", async () => {
  const input = "0." + "0".repeat(100000) + "1";
  expect(await parse(input, 113)).toBe(input);
});

it("compares stored keys after hash collisions", async () => {
  // These keys collide for the root object namespace (offset 8). Both distinct
  // keys must survive, and a duplicate at the end of the bucket must fail.
  const first = "gxpzlhzwrf", second = "yuyuhephzi";
  expect(JSON.parse(await parse(`{"${first}":1,"${second}":2}`))).toEqual({[first]: 1, [second]: 2});
  await expect(parse(`{"${first}":1,"${second}":2,"${first}":3}`)).rejects.toThrow("Duplicate object key");
});
it("observes timer cancellation inside a long token and cleans backing storage", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await expect(parse('"' + "x".repeat(100000) + '"', 4096, controller.signal)).rejects.toMatchObject({code: "E_CANCELLED"});
  } finally {clearTimeout(timer);}
});

it("reports the source offset of the duplicate property", async () => {
  await expect(parse(String.raw`{"a":1,"\u0061":2}`)).rejects.toThrow("7: Duplicate object key");
});

it("cleans a spilled duplicate-key index after rejecting late duplicates", async () => {
  const input = JSON.stringify(Object.fromEntries(Array.from({length: 1000}, (_, index) => [`key${index}`, index])));
  await expect(parse(input.slice(0, -1) + ',"key0":null}', 4096)).rejects.toThrow("Duplicate object key");
});

it.each(["9007199254740992", "9007199254740990.5", "1e9999", "1e-9999"])("applies streamed numeric policy at the original offset: %s", async number => {
  await expect(parse('[0,' + number + ']', 1, undefined, true)).rejects.toThrow("3: Number exceeds exact integer range or is rounded");
});
it("validates a long fractional spelling directly from backed storage", async () => {
  const token = "0.1" + "0".repeat(30000);
  expect(await parse('[' + token + ']', 113, undefined, true)).toBe('[' + token + ']');
});
