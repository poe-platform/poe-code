import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { HtmlBudget } from "./contracts.js";
import { StoredUrls } from "./stored-url.js";

test("stored URL parsing and resolution preserve native URL semantics", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir('/scratch');
  const options = { signal: new AbortController().signal };
  const storage = new PagedStorage({ fs, cwd: '/scratch', env: {}, ...options }, 2), text = new TextStore(storage);
  const urls = new StoredUrls(text, storage, new HtmlBudget(options));
  const bases = [undefined, 'https://u:p@Example.com:8080/a/b?old#fragment', 'http://127.1/a/', 'file:///C:/dir/file', 'file://server/share/file', 'file:///tmp/file', 'custom://HoSt/a/b', 'custom:/a/b', 'custom:opaque?q#f', 'custom:a/b/c?q', 'custom:a//b#old', 'custom:', 'custom:/.//a', 'data:text/plain,hello', 'https://é.example/'];
  const inputs = ['/', '///', '//', '/?q', '/#f', '//?q', 'file:', 'file:#f', 'file:?q', 'file:/', 'file://', 'custom://host', 'custom://host?', 'custom://host#', 'custom:/', 'custom:', 'https:', 'https:#f', '', ' ', '\t\r\n', '#', '?', '?x=é\'"#a b', '#é<>`', '.', '..', '../..', '../../x', '/a//b/../c/.', '//Host:80/x', '///x', '/\\x/a', '\\x', '\\\\x', 'http:x', 'https:x', 'https:/x', 'https:\\x', 'https://u:p@@ExAmPlE:000443/a', 'https://[::1]:000443/x', 'https://[bad]/', 'https://0x7f.1/', 'https://é.test/a', 'custom:x y?x y#z', 'custom:/x', 'custom://HoSt/a', 'custom://é.test/a', 'custom:///a', 'custom://host:90/a', 'custom://@/a', 'custom://host:/a', 'data:a b #f', 'file:x', 'file:/x', 'file://localhost/C|/x', 'file://C:/x', 'file:///C|/x', 'file://server/x', 'file://u@server/x', 'file://server:1/x', 'C|/x', '/C|/x', '../C|/x', 'c:/x', '.%2e/x', '%2e./x', '%2e%2e/x', 'a b<>"`{}|^/é', '\u0001a\u0002', 'custom://a\u0001b/x', 'a\tb\nc\rd', 'javascript:alert(1)'];
  let seed = 9123;
  const symbols = ["a", "/", "\\", ":", "?", "#", "@", ".", "%2e", " ", "é", "[", "]", "|", "0", "\u0001"];
  for (let sample = 0; sample < 100; sample++) {
    let input = ["", "http:", "file:", "custom:", "//"][sample % 5]!;
    for (let i = 0; i < 8; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; input += symbols[(seed >>> 16) % symbols.length]; }
    inputs.push(input);
  }
  const string = async (root: number) => { let value = ''; for await (const chunk of text.chunks(root)) value += chunk; return value; };
  try {
    for (const base of bases) {
      const storedBase = base === undefined ? undefined : await urls.parse(await text.from(base));
      for (const input of inputs) {
        let expected: string | undefined;
        try { expected = new URL(input, base).href; } catch { /* Invalid URLs stay invalid. */ }
        const actual = await urls.parse(await text.from(input), storedBase);
        assert.equal(actual ? await string(await urls.serialize(actual)) : undefined, expected, `${JSON.stringify(input)} / ${base}`);
      }
    }
  } finally { await storage.close(); }
});

test("large URL components stay stored and native probes stay bounded", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir('/scratch');
  const options = { signal: new AbortController().signal };
  const storage = new PagedStorage({ fs, cwd: '/scratch', env: {}, ...options }, 2), text = new TextStore(storage);
  const urls = new StoredUrls(text, storage, new HtmlBudget(options));
  const original = globalThis.URL;
  let peak = 0;
  globalThis.URL = class extends original {
    constructor(input: string | URL, base?: string | URL) {
      const length = String(input).length + String(base ?? '').length;
      peak = Math.max(peak, length); assert.ok(length <= 4096, `Payload-wide native URL: ${length}`);
      super(input, base);
    }
  };
  try {
    const large = text.builder(); for (let i = 0; i < 8; i++) await large.write('x'.repeat(4096));
    const payload = await large.finish();
    const input = text.builder(); await input.write('https://'); await input.append(payload);
    await input.write(':'); await input.append(payload); await input.write('@'); await input.append(payload);
    await input.write('.test/a/'); await input.append(payload); await input.write('?q='); await input.append(payload); await input.write('#'); await input.append(payload);
    const root = await input.finish(), parsed = await urls.parse(root);
    assert.ok(parsed);
    const serialized = await urls.serialize(parsed);
    assert.equal((await text.info(serialized)).length, (await text.info(root)).length);
    const resolved = await urls.parse(await text.from('../b?new#f'), parsed);
    assert.ok(resolved);
    const result = await urls.serialize(resolved);
    assert.equal((await text.info(result)).length, 3 * (await text.info(payload)).length + 'https://:@.test/b?new#f'.length);
    assert.ok(peak <= 4096);
  } finally { globalThis.URL = original; await storage.close(); }
});
