import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";
import {decodeRetainedYamlBinary, resolveRetainedYamlTimestamp} from "./retained-yaml-special.js";

async function fixture(value: string, run: (text: BackedText, range: Awaited<ReturnType<BackedText["from"]>>) => Promise<void>) {
  const fs = new MemoryFileSystem(), storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const text = new BackedText(storage, async () => {});
  try {await run(text, await text.from([value]));}
  finally {await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each(["", "AA==", "AAA=", "AAAA", "AA", "AAA", "Y W\nJ\rj\tZA==", "A", "A===", "AA=", "AA===", "AAAA=", "AA==AA==", "AA-_", "AA!", "AA\u000b", "YWJj".repeat(4096)])("matches shipped browser YAML binary semantics: %j", async value => {
  let expected: string | undefined;
  try {expected = atob(value);} catch { /* The shipped YAML browser entry uses atob. */ }
  await fixture(value, async (text, range) => {
    const action = decodeRetainedYamlBinary(text, range);
    if (expected === undefined) await expect(action).rejects.toThrow();
    else {let actual = ""; for await (const chunk of text.chunks(await action)) actual += chunk; expect(actual).toBe(expected);}
  });
});
it.each(["2001-12-15", "0000-1-1", "9999-99-99", "2001-12-15T02:59:43.1Z", "2001-12-15 2:59:43.123456 -03:30", "2001-12-15\t2:59:43+5", "2001-12-15t2:59:43-00:15", "2001-12-15 2:59:43+29:99", "2001-12-15T2:59:43.00001", "2001-12-15T2:59:43.", "2001-12-15T2:59", "2001-12-15Z", "2001-12-15T2:59:43+30", "2001-12-15 ", "2001-12-15T2:59:43 ", "01-12-15", "2001-12-15T2:59:43." + "1".repeat(8192) + "Z"])("matches explicit YAML timestamps: %j", async value => {
  const doc = parseDocument("!!timestamp " + JSON.stringify(value));
  await fixture(value, async (text, range) => {
    const action = resolveRetainedYamlTimestamp(text, range);
    if (doc.errors.length) await expect(action).rejects.toThrow();
    else expect(await action).toBe((doc.toJS() as Date).getTime());
  });
});
