import {expect, it, vi} from "vitest";
import {Volume} from "memfs";
import {convert, createJsonFilterCapability, type JsonFilterRuntime} from "./index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const input = [{bytes: encoder.encode("Hello")}];
const options = {from: "commonmark", to: "html", filters: [{kind: "json" as const, path: "./identity.py"}]};

it("exchanges Pandoc JSON and the writer argument with the supplied runtime", async () => {
  const signal = new AbortController().signal;
  const run = vi.fn<JsonFilterRuntime["run"]>(async invocation => {
    expect(invocation.path).toBe("./identity.py");
    expect(invocation.args).toEqual(["html"]);
    expect(invocation.signal.aborted).toBe(false);
    const document = JSON.parse(decoder.decode(invocation.stdin));
    expect(document).toEqual({
      "pandoc-api-version": [1, 23, 1, 2],
      meta: {title: {t: "MetaString", c: "Audit"}},
      blocks: [{t: "Para", c: [{t: "Str", c: "Hello"}]}]
    });
    document.blocks[0].c[0].c = "HELLO";
    await invocation.stdout.write(encoder.encode(JSON.stringify(document)));
    return 0;
  });
  const result = await convert(input, {...options, metadataJson: [{title: "Audit"}]}, {signal, filters: createJsonFilterCapability({run})});
  expect(result).toMatchObject({kind: "text", text: "<p>HELLO</p>\n"});
  expect(run).toHaveBeenCalledOnce();
});

it("round-trips Pandoc enum constructors and owns reused output chunks", async () => {
  const source = encoder.encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [
    {t: "Para", c: [{t: "Quoted", c: [{t: "DoubleQuote"}, [{t: "Str", c: "é😀"}]]}]}
  ]}));
  const filters = createJsonFilterCapability({async run({stdin, stdout}) {
    const buffer = new Uint8Array(1);
    for (const byte of stdin) {buffer[0] = byte; await stdout.write(buffer);}
    buffer.fill(255);
    return 0;
  }});
  const result = await convert([{bytes: source}], {...options, from: "json", to: "json"}, {filters});
  expect(result.kind === "text" && JSON.parse(result.text)).toEqual(JSON.parse(decoder.decode(source)));
});

it.each([
  ["nonzero status", 4, "{}", "E_IO"],
  ["invalid status", NaN, "{}", "E_IO"],
  ["empty output", 0, "", "E_AST"],
  ["malformed JSON", 0, "{", "E_AST"],
  ["unsupported version", 0, '{"pandoc-api-version":[0,0,0,0],"meta":{},"blocks":[]}', "E_AST"],
  ["invalid AST", 0, '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Unknown"}]}', "E_AST"]
] as const)("rejects %s without publishing or running the next filter", async (_name, exitCode, output, code) => {
  const publish = vi.fn();
  const run = vi.fn<JsonFilterRuntime["run"]>(async ({stdout}) => {await stdout.write(encoder.encode(output)); return exitCode;});
  await expect(convert(input, {...options, filters: [...options.filters, ...options.filters]}, {filters: createJsonFilterCapability({run}), output: {publish}})).rejects.toMatchObject({code});
  expect(publish).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
});

it("enforces output limits even if a runtime swallows a write error", async () => {
  const publish = vi.fn();
  const filters = createJsonFilterCapability({async run({stdout}) {
    await stdout.write(new Uint8Array(257)).catch(() => {});
    return 0;
  }});
  await expect(convert(input, options, {filters, limits: {inputBytes: 256}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});

it("rejects invalid UTF-8 returned by the runtime", async () => {
  const filters = createJsonFilterCapability({async run({stdout}) {await stdout.write(Uint8Array.of(255)); return 0;}});
  await expect(convert(input, options, {filters})).rejects.toMatchObject({code: "E_ENCODING"});
});

it("cancels runtime work when bounded output fails without caller cancellation", async () => {
  const publish = vi.fn();
  const filters = createJsonFilterCapability({async run({stdout, signal}) {
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    await stdout.write(new Uint8Array(257)).catch(() => {});
    expect(signal!.aborted).toBe(true);
    expect(signal!.reason).toMatchObject({code: "E_LIMIT"});
    return 0;
  }});
  await expect(convert(input, options, {filters, limits: {inputBytes: 256}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});

it("closes the runtime cancellation scope after successful cleanup", async () => {
  const controller = new AbortController();
  let runtimeSignal: AbortSignal | undefined;
  const filters = createJsonFilterCapability({async run({stdin, stdout, signal}) {
    runtimeSignal = signal;
    await stdout.write(stdin);
    return 0;
  }});
  await convert(input, options, {filters, signal: controller.signal});
  expect(runtimeSignal!.aborted).toBe(true);
  expect(controller.signal.aborted).toBe(false);
});

it("forwards caller cancellation and its reason to runtime cleanup", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped");
  let cleaned = false;
  const filters = createJsonFilterCapability({async run({signal}) {
    const cleanup = new Promise<number>(resolve => signal.addEventListener("abort", () => {
      expect(signal.reason).toBe(reason);
      cleaned = true;
      resolve(0);
    }, {once: true}));
    controller.abort(reason);
    return cleanup;
  }});
  await expect(convert(input, options, {filters, signal: controller.signal})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(cleaned).toBe(true);
});

it("preflights the entire filter chain before acquiring input", async () => {
  const acquire = vi.fn();
  const run = vi.fn<JsonFilterRuntime["run"]>();
  const chunks = (async function* () {acquire(); yield input[0]!.bytes;})();
  await expect(convert([{chunks}], {...options, filters: [...options.filters, {kind: "citeproc"}]}, {filters: createJsonFilterCapability({run})})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(acquire).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it("cancels runtime work without publishing and rejects late output", async () => {
  const controller = new AbortController();
  const publish = vi.fn();
  let output: Parameters<JsonFilterRuntime["run"]>[0]["stdout"] | undefined;
  const filters = createJsonFilterCapability({async run({stdout}) {output = stdout; controller.abort(); return new Promise(() => {});}});
  await expect(convert(input, options, {filters, signal: controller.signal, output: {publish}})).rejects.toMatchObject({code: "E_CANCELLED"});
  await expect(output!.write(encoder.encode("late"))).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(publish).not.toHaveBeenCalled();
});

it("rejects output written after the runtime has returned", async () => {
  let output: Parameters<JsonFilterRuntime["run"]>[0]["stdout"] | undefined;
  const filters = createJsonFilterCapability({async run({stdin, stdout}) {output = stdout; await stdout.write(stdin); return 0;}});
  await convert(input, options, {filters});
  await expect(output!.write(encoder.encode("late"))).rejects.toMatchObject({code: "E_IO"});
});

it.each([["gfm-pipe_tables", "gfm"], ["html", "html"], ["html5", "html5"]] as const)("passes only the base writer name for %s", async (to, expected) => {
  const run = vi.fn<JsonFilterRuntime["run"]>(async ({args, stdin, stdout}) => {
    expect(args).toEqual([expected]);
    await stdout.write(stdin);
    return 0;
  });
  await convert(input, {...options, to}, {filters: createJsonFilterCapability({run})});
  expect(run).toHaveBeenCalledOnce();
});

it.each(["p.png", "p.png#label:part", "p.png?uri=https://example.test/a"])("refuses ambiguous image origin %s before a JSON filter can select the wrong file", async target => {
  const volume = Volume.fromJSON({"/doc/p.png": "DOCUMENT IMAGE", "/cwd/p.png": "WRONG CWD IMAGE"});
  const readFile = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {volume.writeFileSync(path, bytes);});
  const run = vi.fn<JsonFilterRuntime["run"]>(async ({stdin, stdout}) => {await stdout.write(stdin); return 0;});
  const resourceFiles = {
    lstat: async (path: string) => ({type: volume.lstatSync(path).isDirectory() ? "directory" : "file"}),
    readFile, writeFile,
    mkdir: async (path: string) => {volume.mkdirSync(path, {recursive: true});}
  };
  await expect(convert([{source: "sample.md", base: "/doc", bytes: encoder.encode(`![image](${target})`)}],
    {...options, extractMedia: "/media"}, {filters: createJsonFilterCapability({run}), resourceFiles, resourceCwd: "/cwd"}
  )).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(run).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

it.each(["/image.png", "https://example.test/image.png"])("preserves unambiguous image target %s", async target => {
  const filters = createJsonFilterCapability({async run({stdin, stdout}) {await stdout.write(stdin); return 0;}});
  const result = await convert([{bytes: encoder.encode(`![image](${target})`)}], options, {filters});
  expect(result).toMatchObject({text: `<p><img src="${target}" alt="image"></p>\n`});
});
