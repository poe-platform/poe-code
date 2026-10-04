import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {ExecutionContext} from "./execution.js";
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
