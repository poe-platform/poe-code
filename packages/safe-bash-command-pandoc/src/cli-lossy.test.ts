import { expect, it } from "vitest";
import { parseConversionArgs } from "./cli.js";
import { createStandalonePandocCommand } from "./safe-bash.js";
import { convert } from "./index.js";

it.each(["rst", "markdown", "gfm", "commonmark", "plain", "latex", "rtf"])("CLI projects HTML containers to %s by default", async to => {
  const stdout: Uint8Array[] = [];
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "html", "-t", to],
    stdin: [new TextEncoder().encode('<h1 id="title">Title</h1><div class="content"><p>Hello <span class="name">world</span></p></div>')],
    signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout.push(bytes); } },
    stderr: { write: async () => {} }
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(Buffer.concat(stdout))).toContain("world");
});

it("keeps explicit lossy compatibility and duplicate validation", () => {
  expect(parseConversionArgs(["--lossy"], {}, new AbortController().signal).options.lossy).toBe(true);
  expect(() => parseConversionArgs(["--lossy", "--lossy"], {}, new AbortController().signal)).toThrow("Repeated option");
});

it("retains strict SDK conversion and CLI fail-if-warnings", async () => {
  const input = [{ bytes: new TextEncoder().encode('<h1 id="title">Title</h1><div class="content"><p>Hello <span data-label="name">world</span></p></div>') }];
  await expect(convert(input, { from: "html", to: "rtf" }, {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_FEATURE" });
  const { options } = parseConversionArgs(["-f", "html", "-t", "rtf", "--fail-if-warnings"], {}, new AbortController().signal);
  await expect(convert(input, options, {})).rejects.toBeDefined();
  const result = await convert(input, { from: "html", to: "rtf", lossy: true }, {});
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

it.each([["a", "c", "d"], ["A", "C", "D"], ["i", "iii", "iv"], ["I", "III", "IV"]])("preserves HTML %s numbering in Markdown", async (type, first, second) => {
  const stdout: Uint8Array[] = [];
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "html", "-t", "markdown"],
    stdin: [new TextEncoder().encode(`<ol start="3" type="${type}"><li>First</li><li>Second</li></ol>`)],
    signal: new AbortController().signal,
    stdout: {write: async bytes => {stdout.push(bytes);}},
    stderr: {write: async () => {}}
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(Buffer.concat(stdout))).toBe(`${first}. First\n${second}. Second\n`);
});

it("preserves HTML ordered-list attributes in standalone JSON output", async () => {
  const stdout: Uint8Array[] = [];
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "html", "-t", "json"],
    stdin: [new TextEncoder().encode('<ol start="3" type="a"><li>First</li></ol>')],
    signal: new AbortController().signal,
    stdout: {write: async bytes => {stdout.push(bytes);}},
    stderr: {write: async () => {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(Buffer.concat(stdout))).blocks[0].c[0]).toEqual([3, {t: "LowerAlpha"}, {t: "DefaultDelim"}]);
});
