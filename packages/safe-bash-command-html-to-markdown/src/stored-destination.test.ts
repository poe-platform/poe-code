import assert from "node:assert/strict";
import test from "node:test";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { Budget } from "./budget.js";
import { destination } from "./entities.js";
import { convert } from "./fixtures.js";
import { settings } from "./options.js";
import { storedDestination } from "./stored-destination.js";
import { TextStore } from "./stored-text.js";

test("stored destinations preserve platform URL and escaping policy", async () => {
  const context = (await convert("")).context, storage = new PagedStorage(context, 1), text = new TextStore(storage);
  const values = ["", " ", "/relative path", "plain", "abc:def", "//example.test", "#fragment", "mailto:x@y", "MAILTO:x@y", "https:example.test", "http:/example.test", "http:///example.test", "http:////example.test", "http://?query", "http://#fragment", "http://@/", "http://user:pass@@example.test/", "http://[::1]", "http://[::1]:00080", "http://[::1]x", "http://[::ffff:192.168.1.1]", "http://[::ffff:001.2.3.4]", "http://é.example/", "http://a%2eb/", "http://%E2%98%83/", "http://a%20b/", "http://a%25b/", "http://%5B::1%5D/", "http://%C0%AF/", "http://%C2%80/", "http://%ED%A0%80/", "http://é%25ab/", "http://a%2/", "http://a%/", "http://a%gg/", "http://%EF%BB%BFexample.test/", "http://xn--bcher-kva/", "http://xn--/", "https://x/a'b(c)[d]{e}|f`g\"h", "https://x/%00", "https://x/%1f", "https://x/%7F", "https://x/%20", "https://x/&named;", "https://x/&#oops;", "https://x/a&b=c", "https://x/&# x;", "https://x/\\x"];
  for (let code = 33; code <= 126; code++) values.push(`http://a${String.fromCharCode(code)}b/`);
  for (const host of ["1.2.3.4", "1.2.3.256", "1.2.65535", "1.2.65536", "1.16777215", "1.16777216", "1.2.3.4.5", "1.2.3.4.", "1.2.3.4..", "1.2.3.a", "1..2", "0x7f.0.0.1"]) values.push(`http://${host}/`);
  const labels = ["", "0", "00", "08", "09", "0x", "0Xf", "0xg", "1", "255", "256", "65535", "65536", "4294967295", "4294967296", "a", "-", "_", "xn--bad", "a+b"];
  for (const left of labels) for (const right of labels) values.push(`http://${left}.${right}/`, `http://${left}.${right}./`);
  for (const port of ["", "0", "00080", "65535", "65536", "12345678901234567890", "-1", "+1", "0x80", "80:90", "a"]) values.push(`http://example.test:${port}/`, `http://[::1]:${port}/`);
  try {
    for (const value of values) for (const image of [false, true]) {
      const expected = await destination(value, image, new Budget(context, settings({})));
      const root = await storedDestination(text, await text.from(value), image, new Budget(context, settings({})));
      let actual = "";
      for await (const chunk of text.chunks(root)) actual += chunk;
      assert.equal(root ? actual : undefined, expected, `${image ? "image" : "link"}: ${value}`);
    }
  } finally { await storage.close(); }
});

test("destination rejection crosses storage leaves before any output is built", async () => {
  const context = (await convert("")).context, storage = new PagedStorage(context, 1), text = new TextStore(storage);
  try {
    for (const suffix of ["%0a", "%7f", "&named;", "&#not-a-number;", "\\", "\u0080"]) {
      const builder = text.builder();
      await builder.write("/" + "x".repeat(2046)); await builder.write(suffix);
      const root = await storedDestination(text, await builder.finish(), false, new Budget(context, settings({})));
      assert.equal(root, 0, suffix);
    }
  } finally { await storage.close(); }
});

test("streamed destination output limits count escaped UTF-8 bytes", async () => {
  const context = (await convert("")).context, storage = new PagedStorage(context, 1), text = new TextStore(storage);
  try {
    const root = await text.from("/a b");
    await assert.rejects(storedDestination(text, root, false, new Budget(context, settings({ limits: { maxOutputBytes: 5 } }))), { code: "EFBIG" });
    const result = await storedDestination(text, root, false, new Budget(context, settings({ limits: { maxOutputBytes: 6 } })));
    assert.equal((await text.info(result)).bytes, 6);
  } finally { await storage.close(); }
});

test("streamed destination validation yields and preserves caller cancellation", async () => {
  const context = (await convert("")).context, controller = new AbortController(), reason = new Error("stop URL validation");
  const storage = new PagedStorage(context, 1), text = new TextStore(storage);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const root = await text.concat(await text.from("https://example.test/"), await text.repeat(await text.from("x"), 65536));
    timer = setTimeout(() => controller.abort(reason), 0);
    await assert.rejects(storedDestination(text, root, false, new Budget({ ...context, signal: controller.signal }, settings({}))), error => error === reason);
  } finally { clearTimeout(timer); await storage.close(); }
});
