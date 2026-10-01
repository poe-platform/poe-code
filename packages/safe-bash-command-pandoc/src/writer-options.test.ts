import {expect, it, vi} from "vitest";
import {convert} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import type {ConversionOptions} from "./types.js";

async function run(input: string, to: string, args: string[], options: object) {
  const stdout = vi.fn(async (_bytes: Uint8Array) => {});
  const stderr = vi.fn(async (_bytes: Uint8Array) => {});
  const bytes = new TextEncoder().encode(input);
  const from = input.startsWith("<") ? "html" : "commonmark";
  expect(await createStandalonePandocCommand().execute({args: ["-f", from, "-t", to, ...args], stdin: [bytes], stdout: {write: stdout}, stderr: {write: stderr}, signal: new AbortController().signal})).toEqual({exitCode: 0});
  const sdk = await convert([{bytes}], {from, to, ...options} as ConversionOptions, {});
  const text = stdout.mock.calls.map(([chunk]) => new TextDecoder().decode(chunk)).join("");
  expect(sdk).toMatchObject({kind: "text", text});
  expect(stderr).not.toHaveBeenCalled();
  return text;
}
it("numbers nested headings and includes linked contents in standalone HTML", async () => {
  const text = await run("# Title\n\n## Child\n\n# Next\n", "html", ["--number-sections", "--toc", "--standalone"], {numberSections: true, toc: true, standalone: true});
  expect(text).toContain('data-number="1.1"');
  expect(text).toContain('<span class="header-section-number">2</span> Next');
  expect(text).toContain('<nav id="TOC" role="doc-toc">');
  expect(text).toContain('href="#child"');
});
it("wraps plain paragraphs at columns and distinguishes preserve and none", async () => {
  expect(await run("# Title\n\nHello world.\n", "plain", ["--columns=10"], {columns: 10})).toBe("Title\n\nHello\nworld.\n");
  expect(await run("one\ntwo three\n", "plain", ["--wrap=auto", "--columns", "80"], {wrap: "auto", columns: 80})).toBe("one two three\n");
  expect(await run("one\ntwo three\n", "plain", ["--wrap=preserve"], {wrap: "preserve"})).toBe("one\ntwo three\n");
});
it("shifts headings, emits ASCII entities and selects line endings", async () => {
  expect(await run("# Café\n", "html", ["--shift-heading-level-by=1", "--ascii", "--standalone=false"], {shiftHeadingLevelBy: 1, ascii: true, standalone: false})).toContain('<h2 id="caf&#233;">Caf&#233;</h2>');
  expect(await run("# Title\n\nHello world.\n", "plain", ["--eol=crlf"], {eol: "crlf"})).toBe("Title\r\n\r\nHello world.\r\n");
  expect(await run("<p>hello<!--comment-->world</p>", "plain", ["--strip-comments"], {stripComments: true})).toBe("helloworld\n");
});
it("rejects malformed options before acquiring input and bounds expanded output", async () => {
  for (const arg of ["--columns=0", "--columns=NaN", "--shift-heading-level-by=7", "--eol=bad", "--standalone=bad", "--wrap=bad"]) {
    const next = vi.fn(async () => ({done: true as const, value: undefined}));
    expect(await createStandalonePandocCommand().execute({args: ["-f", "commonmark", "-t", "plain", arg], stdin: {[Symbol.asyncIterator]: () => ({next})}, stdout: {write: vi.fn()}, stderr: {write: vi.fn()}, signal: new AbortController().signal})).toEqual({exitCode: 2});
    expect(next).not.toHaveBeenCalled();
  }
  await expect(convert([{bytes: new TextEncoder().encode("é")}], {from: "commonmark", to: "html", ascii: true} as ConversionOptions, {limits: {outputBytes: 10}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("strips Markdown raw comments while preserving fenced code", async () => {
  expect(await run("Hello <!--comment-->world.\n", "plain", ["--strip-comments"], {stripComments: true})).toBe("Hello world.\n");
  expect(await run("<!--comment-->\n\nHello\n", "plain", ["--strip-comments"], {stripComments: true})).toBe("Hello\n");
  expect(await run("```\n<!--comment-->\n```\n", "plain", ["--strip-comments"], {stripComments: true})).toBe(await run("```\n<!--comment-->\n```\n", "plain", [], {}));
});

it.each(["commonmark", "gfm", "rst", "latex"])("accepts shared text writer options for %s with CLI/SDK parity", async to => {
  const text = await run("<p>Text</p>", to,
    ["--columns=60", "-s", "-M", "title=Doc", "--toc", "--ascii", "--eol=crlf", "--raw-content=reject"],
    {columns: 60, standalone: true, metadata: {title: {t: "MetaString", c: "Doc"}}, toc: true, ascii: true, eol: "crlf", rawContent: "reject"});
  expect(text).toContain("Text");
  expect(text).toContain("\r\n");
});
it.each(["commonmark", "gfm"])("wraps %s prose without breaking inline code or fenced blocks", async to => {
  expect(await run("one two three\n", to, ["--wrap=auto", "--columns=7"], {wrap: "auto", columns: 7})).toBe("one two\nthree\n");
  expect(await run("one\ntwo three\n", to, ["--wrap=preserve"], {wrap: "preserve"})).toBe("one\ntwo three\n");
  expect(await run("one `two three` four\n", to, ["--wrap=auto", "--columns=7"], {wrap: "auto", columns: 7})).toBe("one\n`two three`\nfour\n");
  expect(await run("```\none two three\n```\n", to, ["--wrap=auto", "--columns=7"], {wrap: "auto", columns: 7})).toBe("```\none two three\n```\n");
});

it("keeps block-looking prose escaped after wrapping and preserves hard breaks", async () => {
  expect(await run("one two - three\n", "commonmark", ["--wrap=auto", "--columns=7"], {wrap: "auto", columns: 7})).toBe("one two\n\\-\nthree\n");
  expect(await run("one\\\ntwo three\n", "commonmark", ["--wrap=auto", "--columns=7"], {wrap: "auto", columns: 7})).toBe("one\\\ntwo\nthree\n");
  expect(await run("one\ntwo three\n", "gfm", ["--wrap=auto", "--columns=20"], {wrap: "auto", columns: 20})).toBe("one two three\n");
});
