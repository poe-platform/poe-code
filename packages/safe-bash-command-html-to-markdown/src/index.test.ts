import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, FsError, type CommandContext, type ByteSource } from "safe-bash-contracts";
import { createHtmlToMarkdownCommand, type HtmlToMarkdownLimits } from "./index.js";

async function convert(input: string | ByteSource, limits: Partial<HtmlToMarkdownLimits> = {}, inputBudget?: CommandContext["inputBudget"]) {
 const values = createCommandArguments([]);
 let stdout = "", stderr = "";
 const result = await createHtmlToMarkdownCommand({ limits }).execute({
  command: "html-to-markdown", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: typeof input === "string" ? toByteSource(input) : input,
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal, ...(inputBudget ? { inputBudget } : {}),
 });
 return { ...result, stdout, stderr };
}

test("discarded comments do not consume retained token bytes", async () => {
 const result = await convert(`<!--${"😃".repeat(100)}--><p>ok</p>`, { maxTokenBytes: 16 });
 assert.deepEqual(result, { exitCode: 0, stdout: "ok\n", stderr: "" });
 assert.equal((await convert("<!--" + "x".repeat(100) + "-->", { maxWorkUnits: 50 })).exitCode, 1);
 assert.equal((await convert("<!--x--><!--y-->", { maxTokens: 1 })).exitCode, 1);
 assert.equal((await convert('<p title="' + "x".repeat(100) + '">ok</p>', { maxTokenBytes: 16 })).exitCode, 1);
});

test("HTML comment closures survive every byte arriving separately", async () => {
 for (const comment of ["<!-->", "<!--->", "<!-- body -->", "<!-- body --!>", "<!-- body > still hidden -->"]) {
  const bytes = new TextEncoder().encode(`${comment}<p>visible</p>`);
  const result = await convert((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })());
  assert.deepEqual(result, { exitCode: 0, stdout: "visible\n", stderr: "" }, comment);
 }
});

test("raw text end tags accept a slash before their closing bracket", async () => {
 for (const tag of ["script", "style", "textarea", "title", "xmp"]) {
  const result = await convert(`<${tag}></${tag}/><p>visible</p>`);
  assert.deepEqual(result, { exitCode: 0, stdout: "visible\n", stderr: "" }, tag);
 }
 const html = '<textarea>kept &amp; text</textarea/><script>hidden</script/ ignored="x>y"><p>visible</p>';
 const bytes = new TextEncoder().encode(html);
 const result = await convert((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })());
 assert.deepEqual(result, { exitCode: 0, stdout: "kept \\& text\n\nvisible\n", stderr: "" });
});

test("HTML input enforces the host cumulative input budget", async () => {
 const totals: number[] = [];
 const result = await convert((async function* () { yield new TextEncoder().encode("<p>"); yield new TextEncoder().encode("hello</p>"); })(), {}, {
  maxBytes: 8, check(total) { totals.push(total); if (total > 8) throw new FsError("EFBIG"); },
 });
 assert.equal(result.exitCode, 1);
 assert.deepEqual(totals, [3, 12]);
 assert.equal(result.stdout, "");
});

test("work limits account for parsing and rendering beyond input bytes", async () => {
 const html = "<div class=foo>hi</div>";
 assert.equal((await convert(html, { maxInputBytes: html.length, maxWorkUnits: 60 })).exitCode, 1);
 assert.deepEqual(await convert(html, { maxInputBytes: html.length, maxWorkUnits: 200 }), { exitCode: 0, stdout: "hi\n", stderr: "" });
});

test("html-to-markdown help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createHtmlToMarkdownCommand().execute({
  command: "html-to-markdown", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
