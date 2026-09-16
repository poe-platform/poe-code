import { expect, it, vi } from "vitest";
import { createPandocCommand } from "./safe-bash.js";
import { convert } from "./engine.js";

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
  expect(text(ctx.stdout)).toBe("gfm\nhtml\nhtml5\njson\nplain\n");
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
  for(const extra of [["--template=x"], ["--template", "x"], ["--variable", "x=y"], ["-Vx=y"], ["--css=x"], ["--include-in-header=x"], ["--metadata"], ["-M", "=x"], ["-M", "title=x", "-M", "title=y"], ["--standalone", "-s"], ["--raw-content=wrong"]]) {
    const ctx = context(["-f", "json", "-t", "html", ...extra]);
    const next = vi.fn(async () => ({done: true as const, value: undefined}));
    expect(await createPandocCommand().execute({...ctx, stdin: {[Symbol.asyncIterator]: () => ({next})}})).toEqual({exitCode: 2});
    expect(next).not.toHaveBeenCalled(); expect(text(ctx.stdout)).toBe(""); expect(text(ctx.stderr)).toContain("E_OPTION:");
  }
});
