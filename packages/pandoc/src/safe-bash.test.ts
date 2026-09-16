import { expect, it, vi } from "vitest";
import { createPandocCommand } from "./safe-bash.js";
import { convert } from "./engine.js";
import { Volume } from "memfs";
import type { ResourceFileSystem } from "./types.js";

const encode = (text: string) => new TextEncoder().encode(text);
function context(args: readonly string[], input = "a,b\nx,y\n") {
  return {args, stdin: (async function* () {for(const byte of encode(input)) yield Uint8Array.of(byte);})(),
    stdout: {write: vi.fn(async (_bytes: Uint8Array) => {})},
    stderr: {write: vi.fn(async (_bytes: Uint8Array) => {})}, signal: new AbortController().signal};
}
function text(sink: ReturnType<typeof context>["stdout"]): string {
  return sink.write.mock.calls.map(call => new TextDecoder().decode(call[0])).join("");
}
it("thin command converts byte stdin using SDK format/options, with no ambient filesystem", async () => {
  const ctx = context(["-f", "csv", "--to=gfm"]);
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(text(ctx.stdout)).toBe("| a | b |\n| --- | --- |\n| x | y |\n");
  expect(text(ctx.stderr)).toBe("");
});
it("requires explicit lossy conversion and prints deterministic paths separately from content", async () => {
  const table = {t: "Table", c: [["", [], []], [null, []], [[{t: "AlignDefault"}, {t: "ColWidthDefault"}], [{t: "AlignDefault"}, {t: "ColWidthDefault"}]],
    [["", [], []], [[["", [], []], [[["", [], []], {t: "AlignDefault"}, 1, 1, [{t: "Plain", c: [{t: "Str", c: "H1"}]}]], [["", [], []], {t: "AlignDefault"}, 1, 1, [{t: "Plain", c: [{t: "Str", c: "H2"}]}]]]]]],
    [[["", [], []], 0, [], [[["", [], []], [[["", [], []], {t: "AlignDefault"}, 1, 2, [{t: "Plain", c: [{t: "Str", c: "span"}]}]]]]]]], [["", [], []], []]]};
  const input = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [table]});
  const strict = context(["--from=json", "-t", "gfm"], input);
  expect(await createPandocCommand().execute(strict)).toEqual({exitCode: 2});
  expect(text(strict.stdout)).toBe("");
  expect(text(strict.stderr)).toBe("E_CAPABILITY: $.blocks[0].c[4][0][3][0][1][0]: Flattened cell span\n");
  const lossy = context(["--from", "json", "--to", "gfm", "--lossy"], input);
  expect(await createPandocCommand().execute(lossy)).toEqual({exitCode: 0});
  expect(text(lossy.stdout)).toBe("| H1 | H2 |\n| --- | --- |\n| span |  |\n");
  expect(text(lossy.stderr)).toBe("W_TABLE_LOSS: $.blocks[0].c[4][0][3][0][1][0]: Flattened cell span\n");
});
it("rejects missing, duplicate, unknown and file arguments before acquiring stdin", async () => {
  for(const args of [[], ["-f", "csv"], ["-f", "csv", "-t"], ["-f", "csv", "-t", "plain", "--lossy=false"], ["-f", "csv", "-t", "plain", "input.csv"], ["-f", "csv", "--from=json", "-t", "plain"]]) {
    const ctx = context(args);
    const next = vi.fn(async () => ({done: true as const, value: undefined}));
    const stdin = {[Symbol.asyncIterator]: () => ({next})};
    expect(await createPandocCommand().execute({...ctx, stdin})).toEqual({exitCode: 2});
    expect(next).not.toHaveBeenCalled(); expect(text(ctx.stdout)).toBe("");
    expect(text(ctx.stderr)).toContain("E_OPTION:");
  }
});
it("preserves inspection, honors cancellation and awaits diagnostic/content byte sinks", async () => {
  const ctx = context(["--list-output-formats"]);
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(text(ctx.stdout)).toBe("commonmark\ngfm\nhtml\nhtml5\njson\nplain\n");
  const controller = new AbortController(); controller.abort();
  await expect(createPandocCommand().execute({...context(["-f", "csv", "-t", "gfm"]), signal: controller.signal})).rejects.toThrow();
  const failing = context(["-f", "csv", "-t", "gfm"]);
  failing.stdout.write.mockRejectedValue(new Error("original sink failure"));
  await expect(createPandocCommand().execute(failing)).rejects.toThrow("original sink failure");
});
it("matches SDK standalone metadata options through the byte-only CLI", async () => {
  const input = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {title: {t: "MetaString", c: "old"}}, blocks: [{t: "Para", c: [{t: "Str", c: "你好"}]}]});
  const ctx = context(["-f", "json", "-t", "html", "--standalone", "--metadata", 'title=<New & "字"', "-M", "lang=ar", "--metadata=dir=rtl"], input);
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  const result = await convert([{bytes: encode(input)}], {from: "json", to: "html5", standalone: true,
    metadata: {title: {t: "MetaString", c: '<New & "字"'}, lang: {t: "MetaString", c: "ar"}, dir: {t: "MetaString", c: "rtl"}}} as import("./types.js").ConversionOptions, {});
  expect(result).toMatchObject({text: text(ctx.stdout)});
  expect(text(ctx.stdout)).toContain('<html lang="ar" dir="rtl">');
  expect(text(ctx.stdout)).toContain('&lt;New &amp; "字"');
  expect(text(ctx.stderr)).toBe("");
});
it("accepts -s, metadata colon syntax, and explicit CLI raw-content policy", async () => {
  const input = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "RawBlock", c: ["html", "<script>x</script>"]}]});
  const ctx = context(["-f=json", "-t=html", "-s", "-Mtitle:raw", "--raw-content=escape"], input);
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(text(ctx.stdout)).toContain("<title>raw</title>");
  expect(text(ctx.stdout)).toContain("&lt;script&gt;x&lt;/script&gt;");
});
it("rejects templates and malformed metadata/options before reading stdin", async () => {
  for(const extra of [["--template=x"], ["--template", "x"], ["--variable", "x=y"], ["-Vx=y"], ["--css=x"], ["--include-in-header=x"], ["--metadata"], ["-M", "=x"], ["--standalone", "-s"], ["--raw-content=wrong"]]) {
    const ctx = context(["-f", "json", "-t", "html", ...extra]);
    const next = vi.fn(async () => ({done: true as const, value: undefined}));
    expect(await createPandocCommand().execute({...ctx, stdin: {[Symbol.asyncIterator]: () => ({next})}})).toEqual({exitCode: 2});
    expect(next).not.toHaveBeenCalled(); expect(text(ctx.stdout)).toBe(""); expect(text(ctx.stderr)).toContain("E_OPTION:");
  }
});
it("shares Markdown wrap none validation with the SDK", async () => {
  const ctx = context(["-f", "commonmark", "-t", "commonmark", "--wrap=none"], "hi\nthere\n");
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(text(ctx.stdout)).toBe("hi\nthere\n");
  for(const wrap of ["auto", "preserve"]) {
    const rejected = context(["-f", "commonmark", "-t", "gfm", `--wrap=${wrap}`], "hi");
    expect(await createPandocCommand().execute(rejected)).toEqual({exitCode: 2}); expect(text(rejected.stdout)).toBe("");
  }
});
it("reads explicit JSON metadata files in order, with repeated metadata overriding files", async () => {
  const fs = Volume.fromJSON({"/one.json": '{"config":{"a":true,"list":[1]},"title":"file"}', "/two.json": '{"config":{"b":false,"list":[],"a":null}}', "/input.md": "hello"});
  const readFile = vi.fn(async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer));
  const ctx = {...context(["-f=commonmark", "-t=json", "--metadata-file=/one.json", "--metadata-file", "/two.json", "-Mtitle=first", "--metadata=title=last", "/input.md"]), readFile};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(JSON.parse(text(ctx.stdout)).meta).toEqual({config: {t: "MetaMap", c: {b: {t: "MetaBool", c: false}, list: {t: "MetaList", c: []}}}, title: {t: "MetaString", c: "last"}});
  expect(readFile.mock.calls.map(call => call[0])).toEqual(["/input.md", "/one.json", "/two.json"]);
});
it("rejects YAML, unsafe execution and unknown flags before any acquisition", async () => {
  for (const option of ["--metadata-file=x.yaml", "--filter=x", "--lua-filter=x", "--citeproc", "--pdf-engine=x", "--unknown"]) {
    const ctx = context(["-f=commonmark", "-t=plain", "/input.md", option]);
    const readFile = vi.fn(async () => encode(""));
    expect(await createPandocCommand().execute({...ctx, readFile})).toEqual({exitCode: 2});
    expect(readFile).not.toHaveBeenCalled(); expect(text(ctx.stdout)).toBe("");
  }
});
it("publishes files through memfs only after warning preflight and keeps destination failures distinct", async () => {
  const fs = Volume.fromJSON({"/output.txt": "original"});
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {fs.writeFileSync(path, bytes);});
  const args = ["-f=commonmark", "-t=plain", "-o", "/output.txt", "--fail-if-warnings"];
  const ctx = {...context(args, "hello"), writeFile};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(fs.readFileSync("/output.txt", "utf8")).toBe("hello\n");
  expect(text(ctx.stdout)).toBe("");
  writeFile.mockClear();
  expect(await createPandocCommand({writer: {format: "plain", write: async (_doc, adapter) => {adapter.report({code: "W_RAW_CONTENT", operation: "convert", message: "loss"}); return {kind: "text", text: "changed"};}}}).execute({...context(args), writeFile})).toEqual({exitCode: 2});
  expect(writeFile).not.toHaveBeenCalled();
  expect(fs.readFileSync("/output.txt", "utf8")).toBe("hello\n");
  writeFile.mockRejectedValue(new Error("destination denied"));
  const denied = {...context(args, "hello"), writeFile};
  expect(await createPandocCommand().execute(denied)).toEqual({exitCode: 2});
  expect(text(denied.stderr)).toContain("E_IO:");
});
it("joins file and explicit stdin operands in their supplied order", async () => {
  const ctx = {...context(["-f=commonmark", "-t=plain", "a.md", "-", "b.md"], "middle"), readFile: vi.fn(async (path: string) => encode(path === "a.md" ? "first" : "last"))};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(text(ctx.stdout)).toBe("first\nmiddle\nlast\n");
});
it("supplies only its configured VFS for CLI resource search and extraction", async () => {
  const volume = Volume.fromJSON({"/work/doc.md": "![x](p.png)", "/assets/p.png": "image"});
  const fs: ResourceFileSystem & {readFile(path: string): Promise<Uint8Array>} = {
    readFile: async path => new Uint8Array(volume.readFileSync(path) as Buffer),
    readStream: async function* (path) {yield new Uint8Array(volume.readFileSync(path) as Buffer);},
    lstat: async path => ({type: volume.lstatSync(path).isDirectory() ? "directory" : "file"}),
    mkdir: async path => {volume.mkdirSync(path, {recursive: true});},
    writeFile: async (path, bytes) => {volume.writeFileSync(path, bytes);}
  };
  const ctx = {...context(["-f=commonmark", "-t=html", "--resource-path=/none:/assets", "--extract-media=media", "doc.md"]), fs, cwd: "/work"};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(volume.readFileSync("/work/media/p.png", "utf8")).toBe("image");
  expect(text(ctx.stdout)).toContain('src="/work/media/p.png"');
  const denied = context(["-f=commonmark", "-t=html", "--extract-media=media"], "![x](p.png)");
  expect(await createPandocCommand().execute(denied)).toEqual({exitCode: 2});
  expect(text(denied.stderr)).toContain("E_CAPABILITY:");
});
it("accepts iterable stdin and a configured VFS with bounded reads but no readStream", async () => {
  const volume = Volume.fromJSON({"/work/p.png": "image"});
  const readFile = vi.fn(async (path: string, _options?: {maxBytes?: number}) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const fs = {
    readFile,
    lstat: async (path: string) => ({type: volume.lstatSync(path).isDirectory() ? "directory" : "file"}),
    mkdir: async (path: string) => {volume.mkdirSync(path, {recursive: true});},
    writeFile: async (path: string, bytes: Uint8Array) => {volume.writeFileSync(path, bytes);}
  };
  const ctx = {...context(["-f=commonmark", "-t=html", "--extract-media=media"]), stdin: [encode("![x](p.png)")], fs, cwd: "/work"};
  expect(await createPandocCommand({limits: {resourceBytes: 5}}).execute(ctx)).toEqual({exitCode: 0});
  expect(readFile).toHaveBeenCalledWith("/work/p.png", expect.objectContaining({maxBytes: 5}));
});
it("preflights CLI media/output conflicts and malformed flags before VFS acquisition", async () => {
  for (const extra of [["--extract-media=/media", "-o=/media/./p.png"], ["--extract-media"], ["--resource-path=/a::/b"], ["--extract-media=../outside"], ["--extract-media=/media", "--extract-media=/other"]]) {
    const readFile = vi.fn(async () => encode("![x](p.png)"));
    const writeFile = vi.fn(async () => {});
    const ctx = {...context(["-f=commonmark", "-t=html", "doc.md", ...extra]), readFile, writeFile};
    expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 2});
    expect(readFile).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled();
  }
});
it("does not accept resource providers through untyped command configuration", async () => {
  const resolve = vi.fn(async () => encode("forbidden"));
  const lstat = vi.fn(async () => ({type: "file"}));
  const injected = {resources: {resolve}, resourceFiles: {lstat}} as unknown as Parameters<typeof createPandocCommand>[0];
  const ctx = context(["-f=commonmark", "-t=html", "--extract-media=/media"], "![x](p.png)");
  expect(await createPandocCommand(injected).execute(ctx)).toEqual({exitCode: 2});
  expect(lstat).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
});
