import {expect, it, vi} from "vitest";
import {FsError} from "@poe-code/safe-fs/core";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {parseConversionArgs} from "./cli.js";
import {convert} from "./engine.js";
import {createPandocCommand} from "./command.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

const encoder = new TextEncoder();

it("accepts a stream-only file capability and opens operands lazily", async () => {
  const signal = new AbortController().signal;
  const closed = vi.fn();
  const readStream = vi.fn(async function* (path: string, supplied: AbortSignal) {
    expect(path).toBe("document.md");
    expect(supplied).toBe(signal);
    try {yield encoder.encode("Hello "); yield encoder.encode("*world*");} finally {closed();}
  });
  const parsed = parseConversionArgs(["-f", "commonmark", "-t", "html", "document.md"], {readStream}, signal);
  expect(readStream).not.toHaveBeenCalled();
  await expect(convert(parsed.operands!, parsed.options, {signal})).resolves.toMatchObject({text: "<p>Hello <em>world</em></p>\n"});
  expect(readStream).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledOnce();
});

it.each(["command", "standalone"])("uses injected streams for document files, defaults, metadata and includes (%s)", async mode => {
  const fs = new MemoryFileSystem();
  for (const [path, text] of Object.entries({
    "/document.md": "Hello *world*",
    "/defaults.yaml": "from: commonmark\nto: html\ninput-files: [document.md]\nmetadata-file: [meta.json]\ninclude-before-body: [before.html]\n",
    "/meta.json": '{"title":"Streamed"}',
    "/before.html": "<aside>Before</aside>"
  })) await fs.writeFile(path, encoder.encode(text));
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file access is forbidden"));
  const readStream = vi.spyOn(fs, "readStream");
  let output = "";
  const stderr = vi.fn(async () => {});
  const context = {
    command: "pandoc", args: ["--defaults", "defaults.yaml"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: {async write(bytes: Uint8Array) {output += new TextDecoder().decode(bytes);}},
    stderr: {write: stderr}
  };
  const result = mode === "command"
    ? await createPandocCommand().execute(context)
    : await createStandalonePandocCommand().execute(context);
  expect(stderr).not.toHaveBeenCalled();
  expect(result).toEqual({exitCode: 0});
  expect(output).toContain("<p>Hello <em>world</em></p>");
  expect(output).toContain("<aside>Before</aside>");
  expect(readFile).not.toHaveBeenCalled();
  expect(readStream.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining(["/document.md", "/defaults.yaml", "/meta.json", "/before.html"]));
});

it("closes a remote source at the input limit without pulling its tail", async () => {
  const fs = new MemoryFileSystem();
  const closed = vi.fn();
  const tail = vi.fn();
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("no whole-file capability"));
  vi.spyOn(fs, "readStream").mockImplementation(async function* (path, options) {
    expect(path).toBe("/remote.md");
    expect(options?.chunkSize).toBe(65536);
    try {
      yield encoder.encode("abc");
      yield encoder.encode("def");
      tail();
      yield encoder.encode("never read");
    } finally {closed();}
  });
  const stdout = vi.fn(async () => {});
  let error = "";
  await expect(createPandocCommand({limits: {inputBytes: 4}}).execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "remote.md"],
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: {write: stdout}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
  })).resolves.toEqual({exitCode: 7});
  expect(error).toContain("E_LIMIT");
  expect(stdout).not.toHaveBeenCalled();
  expect(tail).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledOnce();
});

it("counts each streamed file byte once against the shell input budget", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document.md", encoder.encode("Hello"));
  const check = vi.fn();
  const result = await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "document.md"],
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
    inputBudget: {maxBytes: 5, check},
    stdout: {async write() {}}, stderr: {async write() {}}
  });
  expect(result).toEqual({exitCode: 0});
  expect(check.mock.calls).toEqual([[5]]);
});

it("uses the same injected stream authority for external image resources", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document.md", encoder.encode("![pixel](pixel.svg)"));
  await fs.writeFile("/pixel.svg", encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'));
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("no whole-file access"));
  const readStream = vi.spyOn(fs, "readStream");
  let output = "";
  const stderr = vi.fn(async () => {});
  const result = await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "--embed-resources", "document.md"],
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {write: stderr}
  });
  expect(stderr).not.toHaveBeenCalled();
  expect(result).toEqual({exitCode: 0});
  expect(readStream.mock.calls.map(([path]) => path)).toEqual(["/document.md", "/pixel.svg"]);
  expect(output).toContain(`;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')}`);
});

it("owns streamed bytes before a remote reader reuses its buffer", async () => {
  const signal = new AbortController().signal;
  const parsed = parseConversionArgs(["-f", "commonmark", "-t", "html", "document.md"], {
    readStream: async function* () {
      const bytes = encoder.encode("one");
      yield bytes;
      bytes.set(encoder.encode("two"));
      yield bytes;
    }
  }, signal);
  await expect(convert(parsed.operands!, parsed.options, {signal})).resolves.toMatchObject({text: "<p>onetwo</p>\n"});
});

it("closes a remote document stream when its next pull cancels the command", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("cancel remote read");
  const closed = vi.fn();
  vi.spyOn(fs, "readStream").mockImplementation(async function* () {
    try {
      yield encoder.encode("first");
      controller.abort(reason);
      yield encoder.encode("never consumed");
    } finally {closed();}
  });
  const stdout = vi.fn(async () => {});
  await expect(createPandocCommand().execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "remote.md"],
    cwd: "/", env: {}, fs, signal: controller.signal, stdin: (async function* () {})(),
    stdout: {write: stdout}, stderr: {async write() {}}
  })).rejects.toBe(reason);
  expect(closed).toHaveBeenCalledOnce();
  expect(stdout).not.toHaveBeenCalled();
});

it.each(["absent", "unsupported"])("reads documents and Lua filters through retained ranges with %s streams", async mode => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/document.md", encoder.encode("Hello"));
  await backing.writeFile("/filter.lua", encoder.encode('function Str(el) el.text = string.upper(el.text); return el end'));
  const readFile = vi.fn(async () => {throw new Error("whole-file access is forbidden");});
  const openReadFile = vi.fn(backing.openReadFile.bind(backing));
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "readStream") return mode === "absent" ? undefined : async function* () {yield await Promise.reject(new FsError("ENOTSUP"));};
      if (key === "readFile") return readFile;
      if (key === "openReadFile") return openReadFile;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let output = "";
  const stderr = vi.fn(async () => {});
  const result = await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "--lua-filter", "filter.lua", "document.md"],
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {write: stderr}
  });
  expect(stderr).not.toHaveBeenCalled();
  expect(result).toEqual({exitCode: 0});
  expect(output).toBe("<p>HELLO</p>\n");
  expect(readFile).not.toHaveBeenCalled();
  expect(openReadFile.mock.calls.map(([path]) => path)).toEqual(["/document.md", "/filter.lua"]);
});
