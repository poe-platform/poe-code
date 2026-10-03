import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

const encoder = new TextEncoder();

it.each([
  ["csv", "a,b\n1,2,3\n4\n"],
  ["csv", '\ufeff"a\r\nb",c\r\n"✓ 😀 <&>","quoted ""text"""\r\n'],
  ["csv", ""], ["csv", "\n"], ["csv", "a,"],
  ["tsv", 'a\tb\n"literal"\t✓\n']
])("streams %s tables with the same output as the document API", async (from, text) => {
  const input = encoder.encode(text);
  const expected = await convert([{bytes: input}], {from, to: "html"}, {});
  let output = "";
  const close = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const summary = await convertToOutput([{chunks: (async function* () {
    for (let offset = 0; offset < input.length; offset += 3) yield input.subarray(offset, offset + 3);
  })()}], {from, to: "html"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
    output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, close, abort}
  });
  expect(expected).toMatchObject({kind: "text", text: output});
  expect(summary).toEqual({kind: "output", diagnostics: []});
  expect(close).toHaveBeenCalledOnce();
  expect(abort).not.toHaveBeenCalled();
});

it("spills a long field and many records without the input or AST collectors", async () => {
  const fs = new MemoryFileSystem();
  const open = vi.spyOn(fs, "open");
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("whole input collection is forbidden"));
  let bytesWritten = 0;
  let largestWrite = 0;
  try {
    await convertToOutput([{chunks: (async function* () {
      yield encoder.encode("header\n");
      for (let i = 0; i < 4; i++) yield new Uint8Array(16384).fill(97);
      for (let i = 0; i < 200; i++) yield encoder.encode("\na");
    })()}], {from: "csv", to: "html"}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {
        async write(bytes) {bytesWritten += bytes.length; largestWrite = Math.max(largestWrite, bytes.length);},
        async close() {}, async abort() {}
      }
    });
    expect(bytesWritten).toBeGreaterThan(4 * 16384);
    expect(largestWrite).toBeLessThanOrEqual(16384);
    expect(open).toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(await fs.readdir("/")).toEqual([]);
  } finally {acquire.mockRestore();}
});

it("validates every input before publishing and cleans backing storage on failure", async () => {
  const fs = new MemoryFileSystem();
  const write = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  await expect(convertToOutput([
    {bytes: encoder.encode("header\n" + "a".repeat(48000))},
    {bytes: encoder.encode('"unterminated'), source: "broken.csv"}
  ], {from: "csv", to: "html"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, abort}
  })).rejects.toMatchObject({code: "E_PARSE", location: "broken.csv:1:14"});
  expect(write).not.toHaveBeenCalled();
  // Preserve the sink contract: an unused output is not aborted.
  expect(abort).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it("uses the backed conversion path from the Safe Bash command", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/table.csv", encoder.encode("a,b\n1,2\n"));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("input collector forbidden"));
  let output = "";
  let error = "";
  try {
    await expect(createPandocCommand().execute({
      command: "pandoc", args: ["-f", "csv", "-t", "html", "/table.csv"],
      fs, cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).resolves.toEqual({exitCode: 0});
    expect(error).toBe("");
    expect(output).toContain('<th scope="col">a</th>');
    expect(output).toContain("<td>1</td>");
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it("aborts a failed output and removes spilled backing files", async () => {
  const fs = new MemoryFileSystem();
  const abort = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  await expect(convertToOutput([{bytes: encoder.encode("a\n" + "x".repeat(48000))}], {from: "csv", to: "html"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write() {throw new Error("sink unavailable");}, close, abort}
  })).rejects.toMatchObject({code: "E_IO"});
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it("cancels during parsing and removes backing files before returning", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const write = vi.fn(async () => {});
  let turns = 0;
  await expect(convertToOutput([{bytes: encoder.encode("a\n" + "x".repeat(48000))}], {from: "csv", to: "html"}, {
    signal: controller.signal, yield: async () => {if (++turns === 4) controller.abort();},
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves optional transformations on the compatibility path", async () => {
  const input = [{bytes: encoder.encode("a,b\n1,2")}];
  const options = {from: "csv", to: "html", standalone: true, metadataJson: [{title: "A table"}]};
  const expected = await convert(input, options, {});
  let text = "";
  await convertToOutput(input, options, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(expected).toMatchObject({text});
});

it.each(["lf", "crlf"] as const)("preserves ASCII output and %s line endings", async eol => {
  const input = [{bytes: encoder.encode('"✓\n😀",<&>')}];
  const options = {from: "csv", to: "html", ascii: true, eol};
  const expected = await convert(input, options, {});
  let text = "";
  await convertToOutput(input, options, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(expected).toMatchObject({text});
});

it("rejects an incomplete output capability before acquiring input", async () => {
  const pull = vi.fn();
  const read = async function* () {pull(); yield encoder.encode("a,b");};
  await expect(convertToOutput([{chunks: read()}], {from: "csv", to: "html"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
    // @ts-expect-error Runtime admission must reject missing sink methods too.
    output: {}
  })).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(pull).not.toHaveBeenCalled();
});

it("preserves separate tables across multiple documents and empty inputs", async () => {
  const inputs = ["a,b\n1,2", "", "c\nd"].map(text => ({bytes: encoder.encode(text)}));
  const options = {from: "csv", to: "html"};
  const expected = await convert(inputs, options, {});
  let text = "";
  await convertToOutput(inputs, options, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(expected).toMatchObject({text});
});

it("rejects late malformed UTF-8 before publication and cleans the backing file", async () => {
  const fs = new MemoryFileSystem();
  const write = vi.fn(async () => {});
  await expect(convertToOutput([{chunks: (async function* () {
    yield encoder.encode("a\n" + "x".repeat(48000));
    yield new Uint8Array([0xc3]);
  })()}], {from: "csv", to: "html"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_ENCODING"});
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it("fails when authorized backing is unavailable without using another filesystem", async () => {
  const fs = new MemoryFileSystem();
  const write = vi.fn(async () => {});
  await expect(convertToOutput([{bytes: encoder.encode("a\n" + "x".repeat(48000))}], {from: "csv", to: "html"}, {
    workingFiles: {fs, directory: "/unavailable", cacheBytes: 16384},
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_IO"});
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([
  {tableRows: 2}, {tableColumns: 2}, {tableCells: 4}, {tableFieldText: 4}
])("keeps table budgets on the backed path: %j", async limits => {
  const input = [{bytes: encoder.encode("a,b\n1,2")}];
  const options = {from: "csv", to: "html"};
  const expected = await convert(input, options, {limits});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("input collector forbidden"));
  let text = "";
  try {
    await convertToOutput(input, options, {
      limits, workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
      output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    expect(expected).toMatchObject({text});
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it.each([
  {tableRows: 1}, {tableColumns: 1}, {tableCells: 3}, {tableFieldText: 0}
])("rejects excessive table dimensions before publication: %j", async limits => {
  const write = vi.fn(async () => {});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("input collector forbidden"));
  try {
    await expect(convertToOutput([{bytes: encoder.encode("a,b\n1,2")}], {from: "csv", to: "html"}, {
      limits, workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
      output: {write, async close() {}, async abort() {}}
    })).rejects.toMatchObject({code: "E_LIMIT"});
    expect(write).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it.each([false, true])("admits exact finite output budgets without collectors (ascii=%s)", async ascii => {
  const inputs = [{bytes: encoder.encode('a,b\n"✓\n😀<&>",')}, {bytes: encoder.encode("c\nd")}];
  const options = {from: "csv", to: "html", ascii, eol: "crlf" as const};
  const expected = await convert(inputs, options, {});
  if (expected.kind !== "text") throw new Error("expected HTML text");
  const length = encoder.encode(expected.text).length;
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("input collector forbidden"));
  try {
    for (const outputBytes of [length, length - 1]) {
      let text = "";
      const write = vi.fn(async (bytes: Uint8Array) => {text += new TextDecoder().decode(bytes);});
      const result = convertToOutput(inputs, options, {
        limits: {outputBytes}, workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
        output: {write, async close() {}, async abort() {}}
      });
      if (outputBytes === length) {
        await result;
        expect(text).toBe(expected.text);
      } else {
        await expect(result).rejects.toMatchObject({code: "E_LIMIT"});
        expect(write).not.toHaveBeenCalled();
      }
    }
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it("accounts for table cells across all input documents before publishing", async () => {
  const inputs = ["a\nb", "c\nd"].map(text => ({bytes: encoder.encode(text)}));
  const options = {from: "csv", to: "html"};
  const limits = {tableCells: 3};
  await expect(convert(inputs, options, {limits})).rejects.toMatchObject({code: "E_LIMIT"});
  const write = vi.fn(async () => {});
  await expect(convertToOutput(inputs, options, {
    limits, workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_LIMIT"});
  expect(write).not.toHaveBeenCalled();
});
