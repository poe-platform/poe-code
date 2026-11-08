import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";
const encoder = new TextEncoder();
const input = {bytes: encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {
  title: {t: "MetaString", c: "original"}, nested: {t: "MetaMap", c: {keep: {t: "MetaBool", c: true}, remove: {t: "MetaString", c: "old"}}}
}, blocks: [{t: "Para", c: [{t: "Str", c: "body"}]}]}))};

async function compare(files: string[], extra: Partial<ConversionOptions> = {}) {
  const options: ConversionOptions = {from: "json", to: "json", metadataFiles: files.map(text => ({bytes: encoder.encode(text), source: "/metadata.json"})), ...extra};
  const source = options.from === "csv" ? {bytes: encoder.encode("head\nvalue")} : input;
  const expected = await convert([source], options, {});
  const fs = new MemoryFileSystem(); let actual = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  try {
    const result = await convertToOutput([source], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); actual += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}
    }});
    expect(expected).toMatchObject({text: actual, diagnostics: result.diagnostics});
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each([{}, {to: "html", standalone: true}, {from: "csv"}, {to: "plain"}])("retains file metadata layers and recursive merge semantics: %j", async options => {
  await compare([
    '{"nested":{"remove":null,"added":["text",true,1.25,{"value":"yes"}]},"title":"first","empty":{},"gone":"x"}',
    '{"title":"second 😀","gone":null,"nested":{"keep":false},"2":"two","1":"one"}'
  ], options);
});
it("preserves JSON duplicate-key replacement before merging and enumeration order", async () => {
  await compare(['{"nested":{"discard":"x"},"nested":{"added":true},"title":null,"title":"last","x":1,"x":2,"1":"old","1":"new"}']);
});
it("uses native JSON metadata number semantics rather than Pandoc AST integer restrictions", async () => {
  await compare(['{"large":9007199254740993,"negativeZero":-0,"tiny":1e-9999,"decimal":1.234567890123456789,"huge":1e308}']);
});
it("retains metadata strings and merge keys larger than the cache", async () => {
  const key = "k".repeat(40000), text = "😀".repeat(18000);
  await compare([JSON.stringify({[key]: {keep: text, remove: true}}), JSON.stringify({[key]: {remove: null, added: text}, title: text})]);
});
it.each(['null', '[]', '{"list":[null]}', '{"constructor":1}', '{"x":1e9999}'])("rejects invalid metadata before publication: %s", async text => {
  const options = {from: "json", to: "json", metadataFiles: [{bytes: encoder.encode(text)}]};
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}}))
      .rejects.toMatchObject({code: expected.code, message: expected.message});
    expect(write).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(['{"x":}', '{\n"x":1,\n}', '{"x":"bad\nvalue"}', '{"x":1 /* comment */}', ''])('preserves malformed metadata diagnostics: %j', async text => {
  const options = {from: "json", to: "json", metadataFiles: [{bytes: encoder.encode(text), source: "/metadata.json"}]};
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {throw new Error("Unexpected publication");}, async close() {}, async abort() {}}}))
    .rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(await fs.readdir("/")).toEqual([]);
});
it("ignores replaced duplicate values before metadata validation", async () => {
  await compare(['{"x":[null],"x":true,"y":{"constructor":1},"y":false,"z":1e9999,"z":"finite"}']);
});
it("retains deeply nested metadata without a recursive merge stack", async () => {
  const fs = new MemoryFileSystem();
  const nested = '{"x":'.repeat(400) + '"leaf"' + '}'.repeat(400);
  let result = "";
  await convertToOutput([input], {from: "json", to: "json", metadataFiles: [{bytes: encoder.encode(nested)}, {bytes: encoder.encode(nested)}]}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {result += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  let value = JSON.parse(result).meta;
  for (let i = 0; i < 399; i++) {expect(value.x.t).toBe("MetaMap"); value = value.x.c;}
  expect(value.x).toEqual({t: "MetaString", c: "leaf"});
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["success", "source-error", "cancel", "sink-error"])("streams reused metadata chunks with cleanup: %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let finalized = 0, pending = 0, size = 0, writes = 0, live = 0, largest = 0;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle); live++;
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {writes++; largest = Math.max(largest, args[0].length); return write(...args);});
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {try {return await close(...args);} finally {live--;}});
    return handle;
  });
  const chunks = async function* () {
    try {
      yield encoder.encode('{"title":"'); const reused = new Uint8Array(8192);
      for (let i = 0; i < 16; i++) {
        reused.fill(97 + i % 2); yield reused;
        if (i === 8 && mode === "source-error") throw new Error("Source failed");
        if (i === 8 && mode === "cancel") controller.abort();
      }
      yield encoder.encode('"}');
    } finally {finalized++;}
  };
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const run = convertToOutput([input], {from: "json", to: "json", metadataFiles: [{chunks: chunks()}]}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {
        expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384);
        if (mode === "sink-error") throw new Error("Sink failed");
        size += bytes.length; await Promise.resolve(); pending--;
      }, close, abort
    }
  });
  if (mode === "success") {await run; expect(size).toBeGreaterThan(131072); expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(finalized).toBe(1); expect(live).toBe(0); expect(writes).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384);
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" ? 1 : 0); expect(read).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});
it("applies file metadata before streamed filters", async () => {
  const fs = new MemoryFileSystem(); let observed = "", output = "";
  await convertToOutput([input], {from: "json", to: "json", metadataFiles: [{bytes: encoder.encode('{"title":"from file"}')}], filters: [{kind: "json", path: "filter"}]}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    filters: {async apply() {throw new Error("Resident filter forbidden");}, async applyJsonStream({stdin, stdout}) {
      for await (const bytes of stdin) {observed += new TextDecoder().decode(bytes); await stdout.write(bytes);}
    }}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(JSON.parse(observed).meta.title).toEqual({t: "MetaString", c: "from file"}); expect(output).toBe(observed);
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["retire", "write"])("rejects backing %s failures before publication", async mode => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs);
  let opened = 0, live = 0, failed = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle), ordinal = ++opened; live++;
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {
      try {await close(...args);} finally {live--;}
      if (mode === "retire" && ordinal === 3) {failed = true; throw new Error("Metadata retirement failed");}
    });
    const write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      if (mode === "write" && ordinal === 3 && !failed) {failed = true; throw new Error("Metadata storage failed");}
      return write(...args);
    });
    return handle;
  });
  const write = vi.fn(async () => {}), close = vi.fn(async () => {});
  await expect(convertToOutput([input], {from: "json", to: "json", metadataFiles: [{bytes: encoder.encode(JSON.stringify({title: "x".repeat(65536)}))}]}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, async abort() {}}
  })).rejects.toMatchObject({code: "E_IO"});
  expect(failed).toBe(true); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(live).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});
it("normalizes BOM and CRLF across arbitrary metadata chunk boundaries", async () => {
  const fs = new MemoryFileSystem(), bytes = encoder.encode('\ufeff{\r\n"title":"😀",\r\n"nested":{"added":true}\r\n}');
  let text = "";
  await convertToOutput([input], {from: "json", to: "json", metadataFiles: [{chunks: (async function* () {for (const byte of bytes) yield Uint8Array.of(byte);})()}]}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(JSON.parse(text).meta.title).toEqual({t: "MetaString", c: "😀"}); expect(await fs.readdir("/")).toEqual([]);
});
it("uses retained metadata files from the CLI without whole-file reads", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document.json", input.bytes);
  await fs.writeFile("/metadata.json", encoder.encode('{"title":"CLI title","nested":{"remove":null}}'));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "json", "-t", "json", "--metadata-file", "/metadata.json", "/document.json"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(error).toBe(""); expect(JSON.parse(output).meta.title).toEqual({t: "MetaString", c: "CLI title"});
    expect(JSON.parse(output).meta.nested.c.remove).toBeUndefined();
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["document.json", "metadata.json"]);
});
it.each([{}, {from: "csv"}, {to: "html", standalone: true}, {to: "plain"}])("retains ordered metadata option layers after files: %j", async extra => {
  await compare(['{"nested":{"added":"file","remove":"file"},"title":"file"}'], {...extra, metadataJson: [
    {nested: {added: "option", remove: null, list: ["text", true, 1.25, {x: "map"}]}, title: "first", gone: "x"},
    {nested: {keep: false}, title: "last 😀", gone: null, "2": "two", "1": "one"}
  ]});
});
it("retains explicit empty metadata layers without fallback", async () => {
  await compare([], {metadataJson: []});
  await compare([], {metadataJson: [{}, {}]});
});
it("retains large option keys, native numbers and strings", async () => {
  const key = "k".repeat(32768), text = "😀".repeat(18000);
  await compare([], {metadataJson: [{[key]: {keep: text, remove: true}, number: 1e308, zero: -0}, {[key]: {remove: null, added: text}, title: text}]});
});
it.each([null, [], "text", {list: [null]}, {constructor: "unsafe"}, {value: Infinity}].flatMap(invalid => ["json", "csv"].map(from => ({invalid, from}))))("validates every option layer before acquiring document input: %#", async ({invalid, from}) => {
  const options = {from, to: "json", metadataJson: [{valid: true}, invalid] as unknown as NonNullable<ConversionOptions["metadataJson"]>};
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(), next = vi.fn(async () => ({done: true as const, value: undefined})), write = vi.fn(async () => {});
  await expect(convertToOutput([{chunks: {[Symbol.asyncIterator]() {return {next};}}}], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message});
  expect(next).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});
it("does not charge resident metadata option values as input bytes", async () => {
  const fs = new MemoryFileSystem(); let output = "";
  await convertToOutput([input], {from: "json", to: "json", metadataJson: [{title: "x".repeat(65536)}]}, {limits: {inputBytes: input.bytes.length}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(JSON.parse(output).meta.title.c).toHaveLength(65536); expect(await fs.readdir("/")).toEqual([]);
});
it.each([8, 32])("keeps option-layer owners bounded for %i layers", async count => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs); let live = 0, peak = 0, largest = 0, writes = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle), write = handle.write.bind(handle); live++; peak = Math.max(peak, live);
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {try {return await close(...args);} finally {live--;}});
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {writes++; largest = Math.max(largest, args[0].length); return write(...args);}); return handle;
  });
  let result = "";
  await convertToOutput([input], {from: "json", to: "json", metadataJson: Array.from({length: count}, (_, index) => ({title: "x".repeat(2048), last: index}))}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {result += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}});
  expect(JSON.parse(result).meta.last.c).toBe(String(count - 1)); expect(peak).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(8);
  expect(writes).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384); expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});
it.each([false, true].flatMap(typed => ["storage-error", "cancel", "sink-error", "retire-error", "success"].map(mode => ({typed, mode}))))("cleans option-layer state on %j", async ({typed, mode}) => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs); let live = 0, emitted = false, failed = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle), write = handle.write.bind(handle); live++;
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      if (!failed && mode === "storage-error") {failed = true; throw new Error("Option storage failed");}
      const result = await write(...args); if (mode === "cancel") controller.abort(); return result;
    });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {
      try {await close(...args);} finally {live--;}
      if (mode === "retire-error" && emitted && !failed) {failed = true; throw new Error("Option retirement failed");}
    }); return handle;
  });
  const next = vi.fn(async () => ({done: true as const, value: undefined})), close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const document = mode === "storage-error" || mode === "cancel" ? {chunks: {[Symbol.asyncIterator]() {return {next};}}} : input;
  const run = convertToOutput([document], {from: "json", to: "json", ...(typed ? {metadata: {title: {t: "MetaString" as const, c: "t".repeat(65536)}}} : {}), metadataJson: [{title: "x".repeat(65536)}, {nested: {remove: null, added: true}}]}, {signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
    async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); emitted = true; if (mode === "sink-error") throw new Error("Destination failed"); await Promise.resolve();}, close, abort
  }});
  if (mode === "success") {await run; expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(next).not.toHaveBeenCalled(); expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" || mode === "retire-error" ? 1 : 0);
});
it("retains CLI metadata assignments after file layers", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(); await fs.writeFile("/document.json", input.bytes);
  await fs.writeFile("/metadata.json", encoder.encode('{"title":"file","nested":{"remove":null,"added":true}}'));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "json", "-t", "json", "--metadata-file=/metadata.json", "-Mtitle=first", '-Mnested={"keep":false}', "--metadata=title=Final", "/document.json"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(error).toBe(""); expect(JSON.parse(output).meta).toEqual({title: {t: "MetaString", c: "Final"}, nested: {t: "MetaMap", c: {keep: {t: "MetaBool", c: false}, added: {t: "MetaBool", c: true}}}});
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["document.json", "metadata.json"]);
});
it("does not interpret extra caller source properties as trusted option storage", async () => {
  const file = {bytes: encoder.encode('{"title":"file"}'), tree: null, root: 0};
  await compare([], {metadataFiles: [file]});
});

it.each([{to: "json"}, {to: "html", standalone: true}, {from: "csv"}, {to: "plain"}, {to: "gfm"}])("retains typed metadata after file and JSON layers: %j", async extra => {
  await compare(['{"title":"file","nested":{"remove":null,"file":true}}'], {...extra,
    metadataJson: [{title: "json", nested: {json: true}}], metadata: {
      title: {t: "MetaString", c: "typed 😀"},
      nested: {t: "MetaMap", c: {keep: {t: "MetaBool", c: false}, typed: {t: "MetaList", c: [{t: "MetaString", c: "last"}]}}},
      blocks: {t: "MetaBlocks", c: [{t: "Para", c: [{t: "Str", c: "metadata body"}]}]}
    }
  });
});
it("converts only typed AST enum positions, including tables, notes and citations", async () => {
  const attr = ["", [], []] as const;
  const para = {t: "Para", c: [{t: "Str", c: "body"}]} as const;
  const row = (align: "AlignLeft" | "AlignRight" | "AlignCenter" | "AlignDefault") => [attr, [[attr, align, 1, 1, [para]]]] as const;
  await compare([], {metadata: {
    literal: {t: "MetaString", c: "AlignLeft"},
    inline: {t: "MetaInlines", c: [
      {t: "Quoted", c: ["SingleQuote", [{t: "Str", c: "quote"}]]}, {t: "Math", c: ["DisplayMath", "x"]},
      {t: "Cite", c: [[{citationId: "id", citationPrefix: [], citationSuffix: [], citationMode: "AuthorInText", citationNoteNum: 0, citationHash: 0}], []]},
      {t: "Note", c: [para]}
    ]},
    block: {t: "MetaBlocks", c: [
      {t: "OrderedList", c: [[2, "UpperRoman", "TwoParens"], [[para]]]},
      {t: "Table", c: [attr, [null, []], [["AlignLeft", {t: "ColWidthDefault"}]], [attr, [row("AlignRight")]], [[attr, 0, [row("AlignCenter")], [row("AlignDefault")]]], [attr, [row("AlignLeft")]]]}
    ]}
  }});
});

it.each([
  {t: "MetaBool", c: 1}, {t: "MetaString", c: NaN}, {t: "MetaString", c: "\ud800"},
  {t: "MetaInlines", c: [{t: "unknown"}]}, {t: "MetaInlines", c: [{t: "\ud800"}]},
  {t: "MetaInlines", c: [{t: "Quoted", c: [{t: "SingleQuote"}, []]}]},
  {t: "MetaList", c: [null]}, {t: "MetaMap", c: {x: null}}, {t: "MetaList", c: new Array(1)},
  Object.assign(Object.create({inherited: true}), {t: "MetaString", c: "text"})
])("rejects invalid typed metadata before document acquisition with compatible errors: %j", async value => {
  const options: ConversionOptions = {from: "json", to: "json", metadata: {x: value} as unknown as NonNullable<ConversionOptions["metadata"]>};
  const expected = await convert([input], options, {}).catch(error => error);
  expect(expected).toMatchObject({code: "E_AST"});
  const next = vi.fn(async () => ({done: true as const, value: undefined})), write = vi.fn(), close = vi.fn();
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([{chunks: {[Symbol.asyncIterator]() {return {next};}}}], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, async abort() {}}})).rejects.toMatchObject({code: expected.code, operation: expected.operation, location: expected.location, message: expected.message});
  expect(next).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});
it("does not execute accessors or retain cycles in typed metadata", async () => {
  const getter = vi.fn(() => "host data");
  const cycle: Record<string, unknown> = {}; cycle.loop = {t: "MetaMap", c: cycle};
  const accessor = Object.defineProperty({t: "MetaString"}, "c", {enumerable: true, get: getter});
  for (const value of [accessor, {t: "MetaMap", c: cycle}]) {
    const options = {from: "json", to: "json", metadata: {x: value} as unknown as NonNullable<ConversionOptions["metadata"]>};
    const expected = await convert([input], options, {}).catch(error => error);
    const fs = new MemoryFileSystem();
    await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: "E_AST", location: expected.location, message: expected.message});
    expect(await fs.readdir("/")).toEqual([]);
  }
  expect(getter).not.toHaveBeenCalled();
});

it("retains deep typed maps and large shared values without mistaking aliases for cycles", async () => {
  const shared = {t: "MetaString", c: "😀".repeat(18000)} as const;
  let nested: NonNullable<ConversionOptions["metadata"]>[string] = {t: "MetaMap", c: {["k".repeat(40000)]: shared, alias: shared}};
  for (let index = 0; index < 60; index++) nested = {t: "MetaMap", c: {child: nested}};
  await compare([], {metadata: {nested}});
});
it.each([
  null, true, 42, "text", [],
  {x: {t: "MetaString", c: "\udc00"}},
  {["\ud800"]: {t: "MetaString", c: "value"}},
  {x: Object.defineProperty({t: "MetaString"}, "c", {value: "hidden"})},
  {x: {t: "MetaList", c: Object.assign([], {extra: true})}},
  {x: {t: "MetaList", c: Object.defineProperty([{t: "MetaBool", c: true}], 0, {enumerable: false})}}
].map(metadata => ({metadata})))("preserves typed metadata reflection errors: %j", async ({metadata}) => {
  const options = {from: "json", to: "json", metadata: metadata as unknown as NonNullable<ConversionOptions["metadata"]>};
  const expected = await convert([input], options, {}).catch(error => error);
  expect(["E_AST", "E_OPTION"]).toContain(expected.code);
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, location: expected.location, message: expected.message});
  expect(await fs.readdir("/")).toEqual([]);
});
