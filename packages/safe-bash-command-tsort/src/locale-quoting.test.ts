import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { shellValueFromBytes } from "safe-bash-contracts/value";
import { createTsortCommand } from "./index.js";

for (const [env, utf8] of [
  [{ LC_ALL: "C.UTF-8" }, true],
  [{ LC_ALL: "C.utf8", LC_CTYPE: "C" }, true],
  [{ LC_ALL: "", LC_CTYPE: "C.UTF-8", LANG: "C" }, true],
  [{ LANG: "en_US.UTF-8" }, true],
  [{ LC_CTYPE: "C.UTF-8", LC_MESSAGES: "C" }, true],
  [{}, false],
  [{ LC_ALL: "C", LC_CTYPE: "C.UTF-8", LANG: "en_US.UTF-8" }, false],
  [{ LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, false],
  [{ LC_CTYPE: "C", LC_MESSAGES: "C.UTF-8" }, false],
] as const) {
  test(`tsort quotes extra operands using the character locale ${JSON.stringify(env)}`, async () => {
    for (const [operand, escaped] of [
      ["extra", "extra"], ["a'b", utf8 ? "a'b" : "a\\'b"],
      ["a\\b", "a\\\\b"], ["a\nb", "a\\nb"], ["", ""],
      ["café", utf8 ? "café" : "caf\\303\\251"],
      ["日本", utf8 ? "日本" : "\\346\\227\\245\\346\\234\\254"],
      ["😀", utf8 ? "😀" : "\\360\\237\\230\\200"],
      ["e\u0301", utf8 ? "e\u0301" : "e\\314\\201"],
      ["a’b", utf8 ? "a\\’b" : "a\\342\\200\\231b"],
      ["a‘b", utf8 ? "a‘b" : "a\\342\\200\\230b"],
      ["\ufeff", utf8 ? "\ufeff" : "\\357\\273\\277"],
      ["\ufffd", utf8 ? "\ufffd" : "\\357\\277\\275"],
      ["\u00a0", utf8 ? "\u00a0" : "\\302\\240"],
      ["\u0001\u007f", "\\001\\177"],
      ["\u0085", "\\302\\205"],
      ["\u2028\u2029", "\\342\\200\\250\\342\\200\\251"],
      ["\u0378", "\\315\\270"],
      [shellValueFromBytes(Uint8Array.of(0x63, 0x61, 0x66, 0xc3, 0xa9, 0xff)), utf8 ? "café\\377" : "caf\\303\\251\\377"],
      [shellValueFromBytes(Uint8Array.of(0xc3, 0x28)), "\\303("],
      [shellValueFromBytes(Uint8Array.of(0xe2, 0x80)), "\\342\\200"],
      [shellValueFromBytes(Uint8Array.of(0xc0, 0xaf)), "\\300\\257"],
      [shellValueFromBytes(Uint8Array.of(0xed, 0xa0, 0x80)), "\\355\\240\\200"],
      [shellValueFromBytes(Uint8Array.of(0xf4, 0x90, 0x80, 0x80)), "\\364\\220\\200\\200"],
    ] as const) {
      const values = createCommandArguments(["f", operand]);
      let stdout = "", stderr = "";
      const result = await createTsortCommand().execute({
        command: "tsort", args: values.args, argumentValues: values, cwd: "/", env,
        fs: createMemoryFileSystem(), stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(stdout, "");
      assert.equal(stderr, `tsort: extra operand ${utf8 ? "‘" : "'"}${escaped}${utf8 ? "’" : "'"}\nTry 'tsort --help' for more information.\n`);
    }
  });
}
