import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

it.each(["empty", "text", "metadata", "long", "unicode", "table"])("retains JSON reference budgets and diagnostics: %s", async kind => {
  const blocks: unknown[] = kind === "empty" ? [] : [{t: "Para", c: [{t: "Str", c: kind === "long" ? "😀".repeat(5000) : kind === "unicode" ? "\ud800" : "value"}]}];
  if (kind === "table") {
    const attr = ["", [], []];
    blocks.splice(0, 1, {t: "Table", c: [attr, [null, []], [[{t: "AlignDefault"}, {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [[attr, [[attr, {t: "AlignDefault"}, 1, 1, []]]]]]], [attr, []]]});
  }
  const meta = kind === "metadata" ? {title: {t: "MetaString", c: "title"}, nested: {t: "MetaMap", c: {x: {t: "MetaBool", c: true}}}} : {};
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta, blocks}));
  for (let references = 0; references < 150; references++) {
    const input = {chunks: [bytes.subarray(0, 17), bytes.subarray(17)], source: "/input.json"};
    const options = {from: "json", to: "json"};
    const expected = await convert([input], options, {limits: {references}}).catch(error => error);
    const fs = new MemoryFileSystem(); let text = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {references}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire, `references=${references}`).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, `references=${references}`).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
      else {expect(actual, `references=${references}`).not.toBeInstanceOf(Error); expect(text).toBe(expected.text);}
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["success", "producer", "storage", "cancel", "sink"].flatMap(mode => ["json", "rtf", "csv", "tsv"].flatMap(from => ["json", "plain", "html5", "rst"].map(to => ({mode, from, to})))))("bounds $from-to-$to reference-limited input transfers and cleans up on $mode", async ({mode, from, to}) => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const bytes = new TextEncoder().encode(from === "rtf" ? String.raw`{\rtf1 ` + "x".repeat(100000) + "}" : from === "csv" || from === "tsv" ? "x".repeat(100000) : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "x".repeat(100000)}]}]}));
  const closed = vi.fn(), close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  let live = 0, writes = 0;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle); live++;
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      expect(args[0].length).toBeLessThanOrEqual(16384);
      if (++writes === 3 && mode === "storage") throw new Error("Storage failed");
      return write(...args);
    });
    vi.spyOn(handle, "close").mockImplementation(async () => {try {await close();} finally {live--;}});
    return handle;
  });
  const chunks = (async function* () {
    try {
      yield bytes.subarray(0, 17);
      if (mode === "producer") throw new Error("Producer failed");
      if (mode === "cancel") controller.abort();
      yield bytes.subarray(17);
    } finally {closed();}
  })();
  const result = convertToOutput([{chunks}], {from, to}, {signal: controller.signal, limits: {references: 1000}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
    async write(chunk) {expect(chunk.length).toBeLessThanOrEqual(16384); if (mode === "sink") throw new Error("Sink failed");}, close, abort
  }});
  if (mode === "success") {await result; expect(close).toHaveBeenCalledOnce();}
  else {await expect(result).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(closed).toHaveBeenCalledOnce(); expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
  expect(abort).toHaveBeenCalledTimes(mode === "sink" ? 1 : 0);
});

it.each([0, 1, 4096])("preserves RTF acquisition error locations with inputBytes=%i", async inputBytes => {
  const bytes = new TextEncoder().encode(String.raw`{\rtf1 ` + "x".repeat(5000) + "}");
  const input = {chunks: [bytes.subarray(0, 4096), bytes.subarray(4096)], source: "/input.rtf"};
  const options = {from: "rtf", to: "json"}, limits = {inputBytes, references: 100};
  const expected = await convert([input], options, {limits}).catch(error => error);
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
    async write() {throw new Error("Output forbidden");}, async close() {}, async abort() {}
  }})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(await fs.readdir("/")).toEqual([]);
});
