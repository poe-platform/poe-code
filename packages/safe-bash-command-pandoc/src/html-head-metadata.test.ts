import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";

const str = (c: string) => ({t: "Str", c});
const space = {t: "Space"};

it.each([
  ['<title>Page</title><meta name="author" content="Bob">', {title: {t: "MetaInlines", c: [str("Page")]}, author: {t: "MetaInlines", c: [str("Bob")]}}],
  ['<title>  Page &amp;\n title </title><meta name="author" content=" Bob &amp; Alice ">', {title: {t: "MetaInlines", c: [str("Page"), space, str("&"), space, str("title")]}, author: {t: "MetaInlines", c: [str("Bob"), space, str("&"), space, str("Alice")]}}],
  ['<title>&lt;em&gt;Page&lt;/em&gt;</title><meta name="author" content="&lt;b&gt;Bob&lt;/b&gt;">', {title: {t: "MetaInlines", c: [str("<em>Page</em>")]}, author: {t: "MetaInlines", c: [str("<b>Bob</b>")]}}],
  ['<script>ignored</script><style>ignored</style>', {}]
])("reads HTML head metadata through the public command: %s", async (head, meta) => {
  let output = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(), args: ["-f", "html", "-t", "json"],
    stdin: (async function* () {yield new TextEncoder().encode(`<html><head>${head}</head><body><p>Text.</p></body></html>`);})(),
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(output)).toMatchObject({meta, blocks: [{t: "Para", c: [str("Text.")]}]});
  expect(JSON.parse(output).meta).toEqual(meta);
});
