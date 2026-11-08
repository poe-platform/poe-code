import {expect, it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {BackedJson, parseBackedJson} from "./index.js";

it("parses fragmented JSON into caller backing and replays owned output", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const context = {fs, cwd: "/scratch", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(context, 1), index = new PagedStorage(context, 1);
  const tree = new BackedJson(storage, async () => {});
  const expected = {text: "é😀\ud800\n".repeat(4000), nested: [null, true, {value: -1.25e20}]};
  const input = JSON.stringify(expected);
  try {
    await parseBackedJson((async function* () {for (let i = 0; i < input.length; i += 7) yield input.slice(i, i + 7);})(), tree, index, async () => {}, (at, message) => {throw new Error(`${at}: ${message}`);});
    const chunks = [];
    for await (const bytes of tree.chunks()) {expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes);}
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(expected);
    const position = await tree.property(tree.rootPosition, "text"); expect(position).toBeDefined();
    expect(await tree.smallText(position!, 100)).toBeUndefined();
    let length = 0; for await (const fragment of tree.scalarChunks(position!)) {expect(fragment.length).toBeLessThanOrEqual(4096); length += fragment.length;}
    expect(length).toBe(expected.text.length);
  } finally {await storage.close(); await index.close();}
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("keeps parser policy and cancellation under caller control", async () => {
  const fs = createMemoryFileSystem(); const controller = new AbortController();
  const context = {fs, cwd: "/", env: {}, signal: controller.signal};
  const storage = new PagedStorage(context, 1), index = new PagedStorage(context, 1);
  const reason = new Error("stop JSON");
  const cooperate = async () => {controller.signal.throwIfAborted();};
  try {
    const tree = new BackedJson(storage, cooperate);
    await expect(parseBackedJson((async function* () {yield '{"x":'; controller.abort(reason); yield '1}';})(), tree, index, cooperate, (_at, message) => {throw new Error(message);})).rejects.toBe(reason);
  } finally {await storage.close(); await index.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("converts long numeric fragments with a caller-selected rounding policy", async () => {
  const {readJsonNumber, JsonNumberError} = await import("./index.js");
  const cooperate = async () => {};
  expect(await readJsonNumber(["9007199254", "740993"], cooperate, false)).toBe(9007199254740992);
  await expect(readJsonNumber(["9007199254740993"], cooperate)).rejects.toBeInstanceOf(JsonNumberError);
  expect(await readJsonNumber(["1.", "0".repeat(10000), "1"], cooperate, false)).toBe(1);
});
