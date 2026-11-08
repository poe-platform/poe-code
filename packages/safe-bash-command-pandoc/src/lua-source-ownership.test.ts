import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, createLuaFilterCapability} from "./index.js";

it.each(["buffered", "retained"].flatMap(mode => ["loader", "reader"].map(kind => ({mode, kind}))))("owns Lua readFile bytes before yielding ($mode, $kind)", async ({mode, kind}) => {
  const encoder = new TextEncoder(), source = encoder.encode('function Str(el) el.text = "saved"; return el end');
  let reused = false;
  const readFile = () => {
    // Reuse after the await continuation receives the bytes, before its next yield.
    queueMicrotask(() => queueMicrotask(() => {source.fill(0); reused = true;}));
    return Promise.resolve(source);
  };
  const filters = createLuaFilterCapability(kind === "loader" ? readFile : {readFile});
  const input = {bytes: encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "original"}]}]}))};
  const options = {from: "json", to: "json", filters: [{kind: "lua" as const, path: "/filter.lua"}]};
  const fs = new MemoryFileSystem(); let text = "";
  if (mode === "buffered") {
    const result = await convert([input], options, {filters});
    expect(result.kind).toBe("text");
    if (result.kind === "text") text = result.text;
  } else {
    await convertToOutput([input], options, {filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
    }});
  }
  expect(reused).toBe(true);
  expect(JSON.parse(text).blocks).toEqual([{t: "Para", c: [{t: "Str", c: "saved"}]}]);
  expect(await fs.readdir("/")).toEqual([]);
});
