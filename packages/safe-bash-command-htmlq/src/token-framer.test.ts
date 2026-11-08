import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { HtmlBudget } from "./contracts.js";
import { HtmlTokenFramer } from "./token-framer.js";

for (const [opening, closing, raw] of [["", "<p>", undefined], ["<!--", "--><p>", undefined], ["<p a='", "'>", undefined], ["", "</script>", "script"]] as const) {
  test(`token frames use bounded caller-backed writes: ${opening || raw || "text"}`, async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
    const signal = new AbortController().signal, storage = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal }, 2);
    const text = new TextStore(storage), budget = new HtmlBudget({ signal });
    let maxWrite = 0, returned = 0;
    async function* source() {
      try { yield opening; for (let i = 0; i < 128; i++) yield "x".repeat(4096); yield closing; }
      finally { returned++; }
    }
    const tokenizer = new HtmlTokenFramer(source(), budget, () => {
      const builder = text.builder();
      return { async write(value: string) { maxWrite = Math.max(maxWrite, value.length); assert.ok(tokenizer.residentInputUnits <= 4112); await builder.write(value); }, finish: () => builder.finish() };
    }, async (root: number) => root);
    try {
      const frame = (await tokenizer.next(raw))!;
      const suffix = opening === "<!--" ? "-->" : opening === "<p a='" ? "'>" : "";
      assert.equal((await text.info(frame)).length, opening.length + 128 * 4096 + suffix.length);
      assert.ok(maxWrite <= 4112);
      assert.ok((await fs.readdir("/scratch")).length === 0, "Spill pathname is detached while its handle remains owned");
    } finally { await tokenizer.close(); await storage.close(); }
    assert.equal(returned, 1);
  });
}
