import {expect, it, vi} from "vitest";
import {createJsonFilterCapability} from "./json-filters.js";
import {ExecutionContext} from "./execution.js";

it("runs stream-only JSON runtimes with bounded owned input and output chunks", async () => {
  const context = Object.assign(new ExecutionContext("convert", {}), {to: "json"});
  let sourceClosed = false, received = 0, largest = 0;
  const filters = createJsonFilterCapability({async runStream({stdin, stdout, path, args}) {
    expect(path).toBe("filter.py");
    expect(args).toEqual(["json"]);
    for await (const chunk of stdin) {expect(chunk.length).toBeLessThanOrEqual(16384); await stdout.write(chunk);}
    return 0;
  }});
  try {
    expect(filters.applyJsonStream).toBeTypeOf("function");
    await filters.applyJsonStream!({
      stdin: (async function* () {
        const reused = new Uint8Array(32768);
        try {for (let index = 0; index < 8; index++) {reused.fill(index); yield reused;}}
        finally {sourceClosed = true;}
      })(),
      stdout: {async write(chunk) {
        largest = Math.max(largest, chunk.length);
        await Promise.resolve();
        for (const byte of chunk) {if (byte !== Math.floor(received++ / 32768)) throw new Error("Borrowed bytes changed");}
      }}, signal: new AbortController().signal
    }, {kind: "json", path: "filter.py"}, context);
    expect(received).toBe(8 * 32768);
    expect(largest).toBeLessThanOrEqual(16384);
    expect(sourceClosed).toBe(true);
  } finally {await context.close();}
});

it("closes unread filter input and rejects late writes after runtime completion", async () => {
  const context = Object.assign(new ExecutionContext("convert", {}), {to: "json"});
  const close = vi.fn(async () => ({done: true as const, value: undefined}));
  const source: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]() {return this;}, async next() {return {done: false, value: new Uint8Array(16384)};}, return: close
  };
  let late: ((bytes: Uint8Array) => Promise<void>) | undefined;
  const filters = createJsonFilterCapability({async runStream({stdin, stdout}) {
    await stdin[Symbol.asyncIterator]().next();
    late = stdout.write;
    return 0;
  }});
  try {
    await filters.applyJsonStream!({stdin: source, stdout: {async write() {}}, signal: new AbortController().signal}, {kind: "json", path: "filter"}, context);
    expect(close).toHaveBeenCalledOnce();
    await expect(late!(new Uint8Array(1))).rejects.toBeDefined();
  } finally {await context.close();}
});

it("preserves a swallowed output error and cancels the runtime", async () => {
  const context = Object.assign(new ExecutionContext("convert", {}), {to: "json"});
  const failure = new Error("destination failed");
  const filters = createJsonFilterCapability({async runStream({stdout, signal}) {
    await stdout.write(new Uint8Array(1)).catch(() => {});
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(failure);
    return 0;
  }});
  try {
    await expect(filters.applyJsonStream!({stdin: (async function* () {})(), stdout: {async write() {throw failure;}}, signal: new AbortController().signal}, {kind: "json", path: "filter"}, context)).rejects.toBe(failure);
  } finally {await context.close();}
});

it("keeps stream-only runtimes compatible with document conversions", async () => {
  const {convert} = await import("./engine.js");
  const encoder = new TextEncoder();
  const filters = createJsonFilterCapability({async runStream({stdin, stdout}) {
    for await (const chunk of stdin) {
      expect(chunk.length).toBeLessThanOrEqual(16384);
      await stdout.write(chunk);
    }
    return 0;
  }});
  const text = JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "CodeBlock", c: [["",[],[]], "hello ".repeat(4000)]}]});
  const result = await convert([{bytes: encoder.encode(text)}], {
    from: "json", to: "json", filters: [{kind: "json", path: "identity"}]
  }, {filters});
  expect(result).toMatchObject({kind: "text", text: text + "\n"});
});

it("rejects concurrent output writes and drains the outstanding operation", async () => {
  const context = Object.assign(new ExecutionContext("convert", {}), {to: "json"});
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  const written = vi.fn(async () => {await pending;});
  const filters = createJsonFilterCapability({async runStream({stdout}) {
    const first = stdout.write(new Uint8Array(1));
    await expect(stdout.write(new Uint8Array(1))).rejects.toMatchObject({code: "E_IO"});
    release();
    await first;
    return 0;
  }});
  try {
    await expect(filters.applyJsonStream!({stdin: (async function* () {})(), stdout: {write: written}, signal: new AbortController().signal}, {kind: "json", path: "filter"}, context)).rejects.toMatchObject({code: "E_IO"});
    expect(written).toHaveBeenCalledOnce();
  } finally {release(); await context.close();}
});

it("chains real streaming filters through retained conversion without document collectors", async () => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {convertToOutput} = await import("./engine.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder();
  const run = vi.fn(async ({stdin, stdout}: {stdin: AsyncIterable<Uint8Array>; stdout: {write(bytes: Uint8Array): Promise<void>}}) => {
    for await (const chunk of stdin) {await stdout.write(chunk.map(byte => byte === 120 ? 121 : byte));}
    return 0;
  });
  const filters = createJsonFilterCapability({runStream: run});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collection forbidden"));
  let output = "";
  try {
    await convertToOutput([{chunks: (async function* () {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"CodeBlock","c":[["",[],[]],"');
      const chunk = new Uint8Array(8192).fill(120);
      for (let i = 0; i < 8; i++) yield chunk;
      yield encoder.encode('"]}]}');
    })()}], {from: "json", to: "json", filters: [{kind: "json", path: "first"}, {kind: "json", path: "second"}]}, {
      filters, workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    expect(JSON.parse(output).blocks[0].c[1]).toBe("y".repeat(8 * 8192));
    expect(run).toHaveBeenCalledTimes(2);
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("streams the command's interpreter invocation without a document collector", async () => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder();
  const source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"x"}]}]}';
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collection forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand({}, name => name === "python3").execute({
      command: "pandoc", args: ["-f", "json", "-t", "json", "--filter", "filter.py"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {yield encoder.encode(source);})(),
      stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}},
      async invoke(name, args, options) {
        expect(name).toBe("python3"); expect(args).toEqual(["--", "/filter.py", "json"]);
        for await (const bytes of options!.stdin!) await options!.stdout!.write(bytes.map(byte => byte === 120 ? 121 : byte));
        return {exitCode: 0};
      }
    })).toEqual({exitCode: 0});
    expect(error).toBe("");
    expect(JSON.parse(output).blocks[0].c[0].c).toBe("y");
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it.each([
  [4, "{", "E_IO"], [0, "{", "E_AST"], [0, "\ufffd", "E_AST"],
  [0, '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Unknown"}]}', "E_AST"]
])("validates filter status and response before publication (%s)", async (status, text, code) => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {convertToOutput} = await import("./engine.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(), write = vi.fn(async () => {});
  const run = vi.fn(async ({stdout}: {stdout: {write(bytes: Uint8Array): Promise<void>}}) => {await stdout.write(encoder.encode(text)); return status as number;});
  await expect(convertToOutput([{bytes: encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}')}], {
    from: "json", to: "json", filters: [{kind: "json", path: "first"}, {kind: "json", path: "second"}]
  }, {filters: createJsonFilterCapability({runStream: run}), workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}})).rejects.toMatchObject({code});
  expect(write).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
  expect(await fs.readdir("/")).toEqual([]);
});

it("charges each filter response byte once and cancels a runtime that swallows budget failure", async () => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {convertToOutput} = await import("./engine.js");
  const encoder = new TextEncoder();
  const input = encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}');
  for (const deficit of [0, 1]) {
    const fs = new MemoryFileSystem();
    let output = "", aborted = false;
    const filters = createJsonFilterCapability({async runStream({stdin, stdout, signal}) {
      for await (const bytes of stdin) {
        try {await stdout.write(bytes);} catch {aborted = signal.aborted; break;}
      }
      return 0;
    }});
    const conversion = convertToOutput([{bytes: input}], {from: "json", to: "json", filters: [{kind: "json", path: "first"}, {kind: "json", path: "second"}]}, {
      filters, limits: {inputBytes: input.length * 3 + 2 - deficit}, workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    if (deficit) {await expect(conversion).rejects.toMatchObject({code: "E_LIMIT"}); expect(aborted).toBe(true); expect(output).toBe("");}
    else {await conversion; expect(output).toBe(new TextDecoder().decode(input) + "\n");}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["relative.png", "/absolute.png", "https://example.test/image.png"])("preserves image-origin admission for %s", async target => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {convertToOutput} = await import("./engine.js");
  const fs = new MemoryFileSystem();
  const run = vi.fn(async ({stdin, stdout}: {stdin: AsyncIterable<Uint8Array>; stdout: {write(bytes: Uint8Array): Promise<void>}}) => {
    for await (const bytes of stdin) await stdout.write(bytes);
    return 0;
  });
  const input = JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["",[],[]], [], [target, ""]]}]}]});
  const conversion = convertToOutput([{bytes: new TextEncoder().encode(input)}], {from: "json", to: "json", filters: [{kind: "json", path: "identity"}]}, {
    filters: createJsonFilterCapability({runStream: run}), workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write() {}, async close() {}, async abort() {}}
  });
  if (target === "relative.png") {await expect(conversion).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"}); expect(run).not.toHaveBeenCalled();}
  else {await conversion; expect(run).toHaveBeenCalledOnce();}
  expect(await fs.readdir("/")).toEqual([]);
});


it.each(["cancel", "spill", "encoding"])("cleans retained filter generations after %s failure", async failure => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {convertToOutput} = await import("./engine.js");
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const write = vi.fn(async () => {}), legacy = vi.fn(async () => {throw new Error("Legacy runtime forbidden");});
  let filtering = false, handles = 0;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); handles++;
    const close = handle.close.bind(handle), write = handle.write.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {handles--;}});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {
      expect(bytes.length).toBeLessThanOrEqual(16384);
      if (filtering && failure === "spill") throw new Error("Injected spill failure");
      return write(bytes, ...rest);
    });
    return handle;
  });
  const runStream = vi.fn(async ({stdout, signal}: {stdout: {write(bytes: Uint8Array): Promise<void>}; signal: AbortSignal}) => {
    filtering = true;
    if (failure === "cancel") controller.abort();
    const bytes = new Uint8Array(failure === "encoding" ? 1 : 65536).fill(255);
    try {await stdout.write(bytes);} catch {expect(signal.aborted).toBe(true);}
    return 0;
  });
  await expect(convertToOutput([{bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}')}], {
    from: "json", to: "json", filters: [{kind: "json", path: "first"}, {kind: "json", path: "second"}]
  }, {signal: controller.signal, filters: createJsonFilterCapability({run: legacy, runStream}), workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: failure === "encoding" ? "E_ENCODING" : failure === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(runStream).toHaveBeenCalledOnce();
  expect(legacy).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(handles).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});
