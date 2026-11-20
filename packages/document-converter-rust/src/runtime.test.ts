import {expect,it,vi} from "vitest";
import {Worker} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import {convert,createConverter} from "./index.js";
import {wasmBase64} from "./wasm.js";

it("exposes the bundled PDF font bytes for matching screen typography", async () => {
  const {instance} = await WebAssembly.instantiate(Buffer.from(wasmBase64, "base64"));
  const font = instance.exports.document_font as (index: number) => bigint;
  const memory = instance.exports.memory as WebAssembly.Memory;
  expect(typeof font).toBe("function");
  for (const [index, path] of [
    [0, "../../pdf-ast-rust/src/fonts/LiberationSans-Regular.ttf"],
    [5, "../../terminal-png-rust/assets/jetbrains-mono-700-normal.ttf"],
    [9, "../../pdf-ast-rust/src/fonts/DocumentSymbolFallback.ttf"],
    [10, "../../pdf-ast-rust/src/fonts/DejaVuSerif.ttf"],
  ] as const) {
    const frame = font(index), address = Number(frame & 0xffffffffn), length = Number(frame >> 32n);
    expect(Buffer.from(memory.buffer, address, length)).toEqual(await readFile(new URL(path, import.meta.url)));
  }
  expect(font(11)).toBe(0n);
});

it.each(["docx", "pdf"] as const)("uses a precompiled module without runtime compilation for %s", async format => {
  const module = await WebAssembly.compile(Buffer.from(wasmBase64, "base64"));
  const request = {mode: "html" as const, format, html: "<h1>Portable export</h1><p>Same Rust document.</p>"};
  const expected = await convert(request);
  const compile = vi.spyOn(WebAssembly, "compile").mockRejectedValue(Error("Runtime compilation is unavailable"));
  try {
    const loader = vi.fn(async () => module);
    const compiled = createConverter(loader);
    const outputs = await Promise.all([compiled(request), compiled(request)]);
    expect(outputs).toEqual([expected, expected]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(compile).not.toHaveBeenCalled();
  } finally {
    compile.mockRestore();
  }
});

it("retries a failed module loader and cancels before loading", async () => {
  const module = await WebAssembly.compile(Buffer.from(wasmBase64, "base64"));
  const unavailable = Error("Module temporarily unavailable");
  const loader = vi.fn<() => Promise<WebAssembly.Module>>().mockRejectedValueOnce(unavailable).mockResolvedValue(module);
  const convert = createConverter(loader);
  const request = {mode: "html" as const, format: "docx" as const, html: "<p>Recovered</p>"};
  await expect(convert(request, {signal: AbortSignal.abort()})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(loader).not.toHaveBeenCalled();
  await expect(convert(request)).rejects.toBe(unavailable);
  expect((await convert(request)).bytes.subarray(0, 4)).toEqual(new Uint8Array([80, 75, 3, 4]));
  expect(loader).toHaveBeenCalledTimes(2);
});

it.each(["docx", "pdf"] as const)("enforces supplied resource budgets before %s conversion", async format => {
  const resources = ["first", "second"].map(id => ({id, bytes: new Uint8Array([0])}));
  for (const limit of ["resources", "resourceBytes", "retainedBytes"]) {
    await expect(convert({mode: "pandoc", format, document: {blocks: [], metadata: {}}, resources, limits: {[limit]: 1}}))
      .rejects.toMatchObject({code: "E_LIMIT", message: expect.stringContaining(limit)});
  }
});

it("bounds retained images and fonts together before font parsing", async () => {
  await expect(convert({mode: "pandoc", format: "pdf", document: {blocks: [], metadata: {}},
    resources: [{id: "image", bytes: new Uint8Array([0])}],
    options: {pdfFonts: [{id: "font", bytes: new Uint8Array([0])}]}, limits: {retainedBytes: 1},
  })).rejects.toMatchObject({code: "E_LIMIT", message: expect.stringContaining("retainedBytes")});
});

it.each(["nodes", "depth"])("bounds typed document %s without requiring raw HTML", async limit => {
  await expect(convert({mode: "pandoc", format: "docx", document: {
    blocks: [{t: "Para", c: [{t: "Strong", c: [{t: "Str", c: "Text"}]}]}], metadata: {},
  }, limits: {[limit]: 1}})).rejects.toMatchObject({code: "E_LIMIT", message: expect.stringContaining(limit)});
});

it("bounds repeated image copies even when the supplied resource is shared", async () => {
  const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg==", "base64"));
  const image = {t: "Image", c: [["", [], []], [], ["pixel.png", ""]]};
  for (const limits of [{images: 1}, {retainedBytes: bytes.length}]) {
    await expect(convert({mode: "pandoc", format: "docx", document: {blocks: [{t: "Para", c: [image, image]}], metadata: {}},
      resources: [{id: "pixel.png", bytes}], limits,
    })).rejects.toMatchObject({code: "E_LIMIT"});
  }
});

it.each(["docx","pdf"] as const)("yields and cancels during %s rendering", async format => {
  const controller = new AbortController();
  let yields = 0;
  // One AST text node avoids cancellation merely walking a large source tree.
  const request = {mode:"pandoc" as const,format,document:{blocks:[{t:"Para",c:[{t:"Str",c:"Long conversion text. ".repeat(10_000)}]}],metadata:{}}};
  await expect(convert(request,{signal:controller.signal,cooperate:async()=>{if (++yields === 2) controller.abort();}})).rejects.toMatchObject({code:"E_CANCELLED"});
  expect(yields).toBe(2);
  const next = await convert({mode:"html",format,html:"<p>Still usable</p>"});
  expect(next.bytes.length).toBeGreaterThan(100);
});

it("keeps concurrent Rust conversions isolated", async () => {
  const outputs = await Promise.all(["First","Second"].map(title=>convert({mode:"html",format:"docx",html:`<p>${title}</p>`})));
  expect(new TextDecoder().decode(outputs[0]!.bytes)).toContain("First");
  expect(new TextDecoder().decode(outputs[0]!.bytes)).not.toContain("Second");
  expect(new TextDecoder().decode(outputs[1]!.bytes)).toContain("Second");
});

it("services AbortSignal timers during Rust work even with a microtask-only host checkpoint", async () => {
  const controller = new AbortController();
  let checkpoints = 0;
  const result = convert({mode:"pandoc",format:"pdf",document:{blocks:[{t:"Para",c:[{t:"Str",c:"Timer cancellation. ".repeat(20_000)}]}],metadata:{}}},{signal:controller.signal,cooperate:async()=>{
    if (++checkpoints === 1) setTimeout(()=>controller.abort(),0);
  }});
  await expect(result).rejects.toMatchObject({code:"E_CANCELLED"});
  expect(checkpoints).toBeGreaterThan(0);
});

it("rejects malformed spans in direct WASM requests without blocking the host", async () => {
  const attr = ["", [], []];
  const spans = [[1, 1e100], [1.5, 1], [1, 1.5], [0, 1], [1, 0], [-1, 1], [1, -1], [10001, 1], [1, 1001], [1, 2 ** 32], [1e100, 1], [NaN, 1], [1, Infinity]];
  const requests = ["docx", "pdf"].flatMap(format => spans.map(([rowspan, colspan]) => ({mode: "pandoc", format, document: {
    blocks: [{t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, []],
      [[attr, 0, [], [[attr, [[attr, "AlignDefault", rowspan, colspan, [{t: "Plain", c: [{t: "Str", c: "Cell"}]}]]]]]]], [attr, []]]}], metadata: {},
  }})));
  // A broken WASM span loop cannot service AbortSignal. Isolate it so this
  // regression always terminates instead of hanging the entire test runner.
  const worker = new Worker(`
    const {parentPort, workerData} = require("node:worker_threads");
    import(workerData.module).then(async ({convert}) => {
      const results = [];
      for (const request of workerData.requests) {
        try { await convert(request); results.push("accepted"); }
        catch (error) { results.push(error.code); }
      }
      parentPort.postMessage(results);
    }).catch(error => { throw error; });
  `, {eval: true, workerData: {module: new URL("../dist/index.js", import.meta.url).href, requests}});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await new Promise<string[]>((resolve, reject) => {
      timer = setTimeout(() => reject(Error("WASM span validation did not finish")), 10000);
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    expect(results).toEqual(requests.map(() => "E_AST"));
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}, 15000);
