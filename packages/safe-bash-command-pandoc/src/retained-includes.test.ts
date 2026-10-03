import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";
const encoder = new TextEncoder();
const source = {bytes: encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {title: {t: "MetaString", c: "Report"}}, blocks: [{t: "Para", c: [{t: "Str", c: "Body 😀"}]}]}))};
const input = (text: string) => ({bytes: encoder.encode(text)});
async function compare(options: Partial<ConversionOptions>) {
  const conversion = {from: "json", to: "html", ...options};
  const document = conversion.from === "csv" ? input("Heading\nBody 😀") : source;
  const expected = await convert([document], conversion, {});
  const fs = new MemoryFileSystem(); let output = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  try {
    const actual = await convertToOutput([document], conversion, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); output += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}
    }});
    expect(expected).toMatchObject({text: output, diagnostics: actual.diagnostics});
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}
it.each([{}, {from: "csv"}, {standalone: false}, {ascii: true}, {eol: "crlf" as const}, {toc: true}])("retains ordered HTML includes: %j", async options => {
  await compare({...options, includeInHeader: [input('<meta name="author" content="Writer">\n'), input('<style>body{color:navy}</style>\n')],
    includeBeforeBody: [input('<aside>Before 😀</aside>\r\n')], includeAfterBody: [input('\n<footer>After</footer>')]});
});
it.each(["$&", "$`", "$'", "$$", "$1", "</body>", "</head>", "$&$$$'$`"])("preserves literal String.replace include behavior: %s", async value => {
  await compare({includeBeforeBody: [input(value)], includeAfterBody: [input(value)], includeInHeader: [input(value)]});
});
it("retains include strings larger than the cache", async () => {
  await compare({includeBeforeBody: [input("x".repeat(65536) + "😀")], includeAfterBody: [input("y".repeat(65536))]});
});
it.each([Uint8Array.of(0xff), Uint8Array.of(0xc2), Uint8Array.of(0xc2, 0x20), Uint8Array.of(0xed, 0xa0, 0x80)])("preserves include UTF-8 errors before reading the document: %j", async bytes => {
  const options = {from: "json", to: "html", includeInHeader: [{bytes}]};
  const expected = await convert([source], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(), next = vi.fn(async () => ({done: true as const, value: undefined}));
  await expect(convertToOutput([{chunks: {[Symbol.asyncIterator]() {return {next};}}}], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {throw new Error("Unexpected publication");}, async close() {}, async abort() {}}}))
    .rejects.toMatchObject({code: expected.code, message: expected.message});
  expect(next).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});
it.each([500000, 100])("preflights included output with budget %i", async outputBytes => {
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {}), close = vi.fn(async () => {});
  const run = convertToOutput([source], {from: "json", to: "html", includeAfterBody: [input("x".repeat(65536))]}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {outputBytes}, output: {write, close, async abort() {}}
  });
  if (outputBytes > 100) {await run; expect(write).toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: "E_LIMIT"}); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();}
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["success", "source-error", "cancel", "sink-error", "storage-error", "retire-error"])("cleans retained include state on %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs);
  let finalized = 0, live = 0, opened = 0, writes = 0, largest = 0, emitted = false, storageFailed = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle), write = handle.write.bind(handle), ordinal = ++opened; live++;
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      writes++; largest = Math.max(largest, args[0].length);
      if (mode === "storage-error" && !storageFailed) {storageFailed = true; throw new Error("Storage failed");}
      return write(...args);
    });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {
      try {await close(...args);} finally {live--;}
      if (mode === "retire-error" && ordinal === 1 && emitted) throw new Error("Include retirement failed");
    });
    return handle;
  });
  const chunks = async function* () {
    try {
      const reused = new Uint8Array(8192);
      for (let i = 0; i < 16; i++) {
        reused.fill(97 + i % 2); yield reused;
        if (i === 8 && mode === "source-error") throw new Error("Include source failed");
        if (i === 8 && mode === "cancel") controller.abort();
      }
    } finally {finalized++;}
  };
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const run = convertToOutput([source], {from: "json", to: "html", includeBeforeBody: [{chunks: chunks()}]}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); emitted = true; if (mode === "sink-error") throw new Error("Sink failed"); await Promise.resolve();}, close, abort
    }
  });
  if (mode === "success") {await run; expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(finalized).toBe(1); expect(live).toBe(0); expect(writes).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384);
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" || mode === "retire-error" ? 1 : 0); expect(await fs.readdir("/")).toEqual([]);
});
it("decodes BOM, surrogate pairs and CRLF across include chunk boundaries", async () => {
  const fs = new MemoryFileSystem(), bytes = encoder.encode('\ufeff<aside>😀\r\n</aside>'); let result = "";
  await convertToOutput([source], {from: "json", to: "html", includeBeforeBody: [{chunks: (async function* () {for (const byte of bytes) yield Uint8Array.of(byte);})()}]}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {result += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(result).toContain('<body>\n<aside>😀\n</aside><p>'); expect(result).not.toContain('\ufeff'); expect(await fs.readdir("/")).toEqual([]);
});
it("streams CLI -H, -B and -A includes without whole-file reads", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document.json", source.bytes); await fs.writeFile("/header.html", encoder.encode('<meta name="test" content="header">'));
  await fs.writeFile("/before.html", encoder.encode("<aside>Before</aside>")); await fs.writeFile("/after.html", encoder.encode("<footer>After</footer>"));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "json", "-t", "html", "-H", "/header.html", "-B", "/before.html", "-A", "/after.html", "/document.json"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(error).toBe(""); expect(output).toContain('<meta name="test" content="header"></head>');
    expect(output).toContain('<body>\n<aside>Before</aside><p>'); expect(output).toContain('<footer>After</footer></body>');
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["after.html", "before.html", "document.json", "header.html"]);
});
it.each([16, 64])("does not rescan a %i-chunk body for each suffix replacement token", async count => {
  const {RetainedOptions} = await import("./retained-options.js");
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs); let reads = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), read = handle.read.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (...args) => {reads++; return read(...args);});
    return handle;
  });
  const context = new ExecutionContext("convert", {});
  const includes = (await RetainedOptions.acquire(context, {fs, directory: "/", cacheBytes: 16384}, {from: "json", to: "html", includeAfterBody: [input("$'".repeat(128))]}))!;
  try {
    const replay = await includes.render((async function* () {
      yield "<body>\n"; const chunk = "x".repeat(8192); for (let i = 0; i < count; i++) yield chunk; yield "</body>\n</html>\n";
    })());
    let units = 0; for await (const chunk of replay()) units += chunk.length;
    expect(units).toBe(7 + count * 8192 + 16 + 128 * 9);
    // Allow linear work for body pages and emitted suffix tokens, not their product.
    expect(reads).toBeLessThan(count * 40 + 128 * 8);
  } finally {await includes.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([
  "$body$\n", "<main>$include-before$$body$$include-after$</main>",
  "$if(body)$yes:$body$$else$no$endif$", "$if(missing)$no$else$$body$$endif$",
  "$for(body)$[$body$]$endfor$", "$for(missing)$no$endfor$$body$",
  "$if(body)$$for(header-includes)$$header-includes$$endfor$$endif$$body$",
  "$$body$$:$missing$:$body$", "$" + "x".repeat(32768) + "$:$body$"
])("retains custom template evaluation case %#", async template => {
  await compare({template: input(template), includeInHeader: [input("HEADER")], includeBeforeBody: [input("BEFORE")], includeAfterBody: [input("AFTER")]});
});

it.each(["$", "$if(body)$x", "$if(body)$x$endfor$", "$for(body)$x$else$y$endfor$", "$bad.name$", "$endif$", "$if(missing)$$bad.name$$endif$$body$", "$if(body)$$if(missing)$a$else$b$endif$$else$c$endif$", "$for(include-before)$x$endfor$"])("preserves template errors and dead branches: %s", async template => {
  const options = {from: "json", to: "html", template: input(template)};
  const expected = await convert([source], options, {}).catch(error => error);
  if (expected.kind === "text") {await compare({template: input(template)}); return;}
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  await expect(convertToOutput([source], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message});
  expect(write).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});
it.each(["success", "source-error", "cancel", "sink-error", "retire-error"])("cleans custom template state on %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs);
  let finalized = 0, live = 0, opened = 0, emitted = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle), ordinal = ++opened; live++;
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {
      try {await close(...args);} finally {live--;}
      if (mode === "retire-error" && ordinal === 1 && emitted) throw new Error("Template retirement failed");
    }); return handle;
  });
  const chunks = async function* () {
    try {
      const reused = new Uint8Array(8192);
      for (let i = 0; i < 8; i++) {
        reused.fill(97 + i % 2); yield reused;
        if (i === 4 && mode === "source-error") throw new Error("Template source failed");
        if (i === 4 && mode === "cancel") controller.abort();
      }
      yield encoder.encode("$body$\n");
    } finally {finalized++;}
  };
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const run = convertToOutput([source], {from: "json", to: "html", template: {chunks: chunks()}}, {
    signal: controller.signal, limits: {outputBytes: 100000}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); emitted = true; if (mode === "sink-error") throw new Error("Sink failed"); await Promise.resolve();}, close, abort
    }
  });
  if (mode === "success") {await run; expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(finalized).toBe(1); expect(live).toBe(0); expect(opened).toBeGreaterThan(0);
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" || mode === "retire-error" ? 1 : 0); expect(await fs.readdir("/")).toEqual([]);
});
it("retains deeply nested template continuations", async () => {
  await compare({template: input("$if(body)$".repeat(128) + "$body$" + "$endif$".repeat(128))});
});

it.each(["$constructor$", "$toString$", "$__proto__$", "$if(constructor)$yes$endif$", "$for(toString)$$toString$$endfor$"])("preserves inherited template binding behavior: %s", async template => {
  const options = {from: "json", to: "html", template: input(template)};
  const expected = await convert([source], options, {}).catch(error => error);
  if (expected.kind === "text") {await compare({template: input(template)}); return;}
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([source], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message});
  expect(await fs.readdir("/")).toEqual([]);
});

it("streams CLI custom templates through caller storage", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document.json", source.bytes); await fs.writeFile("/template.html", encoder.encode("<main>\n$body$\n</main>\n"));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "json", "-t", "html", "--template", "/template.html", "/document.json"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(error).toBe(""); expect(output).toBe("<main>\n<p>Body 😀</p>\n</main>\n");
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["document.json", "template.html"]);
});
