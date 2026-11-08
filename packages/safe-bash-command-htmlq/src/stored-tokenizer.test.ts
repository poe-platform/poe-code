import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { DocumentStore } from "./document-store.js";
import { HtmlBudget } from "./contracts.js";
import { HtmlTokenizer } from "./tokenizer.js";
import { StoredHtmlTokenizer } from "./stored-tokenizer.js";

for (const [source, raw, foreign] of [
  ['<TAG A="&notit; &amp; &#00065;" a=ignored =odd=x / b=unquoted/>', undefined, false],
  ['<x ' + Array.from({ length: 200 }, (_, i) => `a${i}=v `).join('') + 'a0=ignored>', undefined, false],
  ['<x' + 'a'.repeat(8192) + ' XML:' + 'b'.repeat(8192) + '="' + 'z'.repeat(16384) + '">', undefined, true],
  ['a&#1\0; &CounterClockwiseContourIntegral; &#x' + '0'.repeat(8192) + '80; &#999999999999999999999999;', undefined, false],
  ['<!doctype x\u00a0 public>', undefined, false], ['</scriptx>hello', 'script', false],
  ['<!--a--!x---y\0--!>', undefined, false], ['<!--->', undefined, false], ['<!--a--!', undefined, false],
  ['<!DOCTYPE \ufeffHTML\u00a0>', undefined, false], ['<![CDATA[x\0]]>', undefined, true],
  ['<?a\0>', undefined, false], ['</!abc>', undefined, false], ['</>', undefined, false], ['</', undefined, false],
  ['<a unfinished="abc', undefined, false], ['hello &amp;\0', 'textarea', false],
  ['<!--<script>x</script>-->\0', 'script', false],
] as const) {
  test(`stored lexical decoding matches compatibility tokenizer: ${source.slice(0, 30)}`, async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir('/scratch');
    const options = { signal: new AbortController().signal };
    const storage = new PagedStorage({ fs, cwd: '/scratch', env: {}, ...options }, 2);
    const text = new TextStore(storage), tree = new DocumentStore(storage);
    async function* chunks() { for (let i = 0; i < source.length; i += 7) yield source.slice(i, i + 7); }
    const tokenizer = new StoredHtmlTokenizer(chunks(), new HtmlBudget(options), tree, text, storage);
    const string = async (id: number) => { let s = ''; for await (const c of text.chunks(id)) s += c; return s; };
    try {
      const token = await tokenizer.next(raw, foreign);
      let actual;
      if (token && 'data' in token) actual = { ...token, data: await string(token.data) };
      else if (token) {
        const attributes = [];
        for await (const a of tree.attributes(token.attributes)) attributes.push({ name: await string(a.name), value: await string(a.value), namespace: a.namespace });
        actual = { ...token, name: await string(token.name), attributes };
      }
      assert.deepEqual(actual, new HtmlTokenizer(source, new HtmlBudget(options)).next(raw, foreign));
    } finally { await tokenizer.close(); await storage.close(); }
  });
}

test("command tree parsing never hands complete large lexical values to text storage", async () => {
  const { parseStoredHtml } = await import("./stored-parser.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const options = { signal: new AbortController().signal };
  let writes = 0, peakWrite = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("Payload-wide I/O");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(target, key) {
        if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
          writes++; peakWrite = Math.max(peakWrite, args[0].byteLength); return handle.write(...args);
        };
        const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const storage = new PagedStorage({ fs: guarded, cwd: "/scratch", env: {}, ...options }, 2);
  const text = new TextStore(storage), tree = new DocumentStore(storage);
  const from = text.from.bind(text);
  text.from = async value => { assert.ok(value.length <= 2048, `Unbounded text conversion: ${value.length}`); return from(value); };
  async function* source() {
    const encode = (s: string) => new TextEncoder().encode(s), chunk = encode("x".repeat(4096));
    yield encode("<x"); for (let i = 0; i < 32; i++) yield chunk;
    yield encode(" a='"); for (let i = 0; i < 32; i++) yield chunk;
    yield encode("'>"); for (let i = 0; i < 32; i++) yield chunk;
    yield encode("<!--"); for (let i = 0; i < 32; i++) yield chunk; yield encode("-->");
  }
  try {
    await parseStoredHtml(source(), tree, text, storage, options);
    assert.ok(writes > 0); assert.ok(peakWrite <= 16384); assert.ok(tree.residentNodes <= 512);
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

test("stored token recovery matches the oracle across generated malformed frames", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const options = { signal: new AbortController().signal };
  const storage = new PagedStorage({ fs, cwd: "/scratch", env: {}, ...options }, 2);
  const text = new TextStore(storage), tree = new DocumentStore(storage);
  const string = async (id: number) => { let value = ""; for await (const c of text.chunks(id)) value += c; return value; };
  let seed = 1937;
  const alphabet = ['<', '>', '/', '!', '?', '-', '=', ' ', '\t', 'a', 'Z', '0', "'", '"', '\0', '&amp;', '&#x80;', '\u00a0'];
  try {
    for (let sample = 0; sample < 128; sample++) {
      let source = ["<x ", "<!--", "<!doctype ", "text", "</", "<?"][sample % 6]!;
      for (let i = 0; i < 48; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; source += alphabet[seed % alphabet.length]; }
      async function* chunks() { for (let i = 0; i < source.length; i += 3) yield source.slice(i, i + 3); }
      const tokenizer = new StoredHtmlTokenizer(chunks(), new HtmlBudget(options), tree, text, storage);
      const oracle = new HtmlTokenizer(source, new HtmlBudget(options));
      try {
        for (;;) {
          const expected = oracle.next(undefined, sample % 2 === 0), token = await tokenizer.next(undefined, sample % 2 === 0);
          let actual;
          if (token && 'data' in token) actual = { ...token, data: await string(token.data) };
          else if (token) {
            const attributes = [];
            for await (const a of tree.attributes(token.attributes)) attributes.push({ name: await string(a.name), value: await string(a.value), namespace: a.namespace });
            actual = { ...token, name: await string(token.name), attributes };
          }
          assert.deepEqual(actual, expected, JSON.stringify(source));
          if (!expected) break;
        }
      } finally { await tokenizer.close(); }
    }
  } finally { await storage.close(); }
});
