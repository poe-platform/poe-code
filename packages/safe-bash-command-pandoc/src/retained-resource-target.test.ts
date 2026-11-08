import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {ExecutionContext} from "./execution.js";
import {localResourceTarget} from "./resources.js";
import {retainedLocalResourceTarget, retainedResourceSuffix} from "./retained-resource-target.js";

it.each([5, 4095, 4096].flatMap(pathUnits => ["?", "#"].map(delimiter => ({pathUnits, delimiter}))))("stops path admission at $delimiter after $pathUnits path units", async ({pathUnits, delimiter}) => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {yield: async () => {}});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  const path = "p".repeat(pathUnits), fragment = delimiter + "😀#tail";
  try {
    const node = await tree.begin("string");
    await tree.text(path);
    for (let i = 0; i < 2048; i++) await tree.text(fragment);
    await tree.end();
    const original = tree.scalarChunks.bind(tree);
    let consumed = 0, closed = 0;
    vi.spyOn(tree, "scalarChunks").mockImplementation(async function* (position) {
      try {for await (const chunk of original(position)) {consumed += chunk.length; yield chunk;}}
      finally {closed++;}
    });
    expect(await retainedLocalResourceTarget(tree, node, context)).toEqual({name: path, suffixUnits: fragment.length * 2048});
    expect(consumed).toBeLessThanOrEqual(Math.ceil((pathUnits + 1) / 4096) * 4096);
    expect(closed).toBe(1);
    let suffix = "";
    for await (const chunk of retainedResourceSuffix(tree, node)) suffix += chunk;
    expect(suffix).toBe(fragment.repeat(2048));
  } finally {await context.close(); await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});


it("rejects an invalid path before reading its retained tail", async () => {
  const context = new ExecutionContext("convert", {});
  let reads = 0, closed = false;
  const tree = {async *scalarChunks() {
    try {reads++; yield "/invalid/"; reads++; yield "tail".repeat(4096);}
    finally {closed = true;}
  }} as unknown as BackedJson;
  try {
    await expect(retainedLocalResourceTarget(tree, 0, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
    expect(reads).toBe(1);
    expect(closed).toBe(true);
  } finally {await context.close();}
});

it("normalizes completed components before requesting more path chunks", async () => {
  const context = new ExecutionContext("convert", {});
  let checkpoints = 0;
  vi.spyOn(context, "checkpoint").mockImplementation(() => {checkpoints++;});
  const tree = {async *scalarChunks() {
    for (let i = 0; i < 128; i++) {
      yield "folder/../";
      expect(checkpoints).toBeGreaterThanOrEqual((i + 1) * 2);
    }
    yield "p%20"; yield "x.png";
  }} as unknown as BackedJson;
  try {expect(await retainedLocalResourceTarget(tree, 0, context)).toEqual({name: "p x.png", suffixUnits: 0});}
  finally {await context.close();}
});


it.each(["a/%2e%2e/p%20x.png", "%7ehome/../😀.png", "a//./b/../x", "../x", "a/%2f/x", "a/%zz", "a/..", "~home/x", "a/colon:x", "a/%00/x"])("preserves URI rules across every chunk boundary in %s", async input => {
  const context = new ExecutionContext("convert", {});
  try {
    for (let split = 0; split <= input.length; split++) {
      const tree = {async *scalarChunks() {yield input.slice(0, split); yield input.slice(split);}} as unknown as BackedJson;
      let expected: string;
      try {expected = localResourceTarget(input, context).name;}
      catch {
        await expect(retainedLocalResourceTarget(tree, 0, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
        continue;
      }
      expect(await retainedLocalResourceTarget(tree, 0, context)).toEqual({name: expected, suffixUnits: 0});
    }
  } finally {await context.close();}
});


it("counts suffix units from raw input after parent normalization", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  try {
    const node = await tree.begin("string");
    for (let i = 0; i < 4096; i++) await tree.text("folder/../");
    await tree.text("p%20x.png?😀#tail");
    await tree.end();
    expect(await retainedLocalResourceTarget(tree, node, context)).toEqual({name: "p x.png", suffixUnits: 8});
  } finally {await context.close(); await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
