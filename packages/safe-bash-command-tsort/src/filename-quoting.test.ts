import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTsortCommand } from "./index.js";

for (const [env, unicode] of [
  [{ LC_ALL: "C" }, false],
  [{ LC_ALL: "C.UTF-8", LC_CTYPE: "C" }, true],
  [{ LC_CTYPE: "C.utf8", LANG: "C" }, true],
  [{ LANG: "C.UTF-8" }, true],
  [{ LC_ALL: "C", LANG: "C.UTF-8" }, false],
  [{ LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, false],
] as const) {
  for (const [name, quoted] of [
    ...["a,b", "a+b", "x@y", "a~b", "a#b", "{ab}"].map(name => [name, name] as const),
    ["~ab", "'~ab'"], ["#ab", "'#ab'"], ["a:b", "'a:b'"], ["a=b", "'a=b'"],
    ["a b", "'a b'"], ["a'b", '"a\'b"'], ['a"b', "'a\"b'"],
    ["a\nb", "'a'$'\\n''b'"], ["a\\b", "'a\\b'"], ["a\n'b", "'a'$'\\n'\\''b'"],
    ["{", "'{'"], ["}", "'}'"], ["a'\"b", "'a'\\''\"b'"],
    ["é", unicode ? "é" : "''$'\\303\\251'"],
    ["é\nb", unicode ? "'é'$'\\n''b'" : "''$'\\303\\251\\n''b'"],
    ["😀", unicode ? "😀" : "''$'\\360\\237\\230\\200'"],
    ["\u0085", "''$'\\302\\205'"], ["\u2028", "''$'\\342\\200\\250'"],
  ] as const) {
    test(`tsort filename diagnostics: ${JSON.stringify(name)}, ${JSON.stringify(env)}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile(`/${name}`, new TextEncoder().encode("a b b a"));
      const values = createCommandArguments([name]);
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      const result = await createTsortCommand().execute({
        command: "tsort", args: values.args, argumentValues: values, cwd: "/", env,
        fs, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 1);
      assert.deepEqual(Buffer.concat(stdout), Buffer.from("a\nb\n"));
      assert.deepEqual(Buffer.concat(stderr), Buffer.from(`tsort: ${quoted}: input contains a loop:\ntsort: a\ntsort: b\n`));
    });
  }
}

for (const [name, locale, quoted] of [["a,b", "C", "a,b"], ["é", "C.UTF-8", "é"]] as const) {
  for (const [kind, message] of [
    ["odd", "input contains an odd number of tokens"],
    ["missing", "No such file or directory"],
    ["directory", "read error: Is a directory"],
  ] as const) {
    test(`tsort quotes filenames consistently for ${kind}: ${name}`, async () => {
      const fs = createMemoryFileSystem();
      if (kind === "odd") await fs.writeFile(`/${name}`, new TextEncoder().encode("a b c"));
      if (kind === "directory") await fs.mkdir(`/${name}`);
      const values = createCommandArguments([name]);
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      const result = await createTsortCommand().execute({
        command: "tsort", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: locale },
        fs, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(Buffer.concat(stdout).length, 0);
      assert.deepEqual(Buffer.concat(stderr), Buffer.from(`tsort: ${quoted}: ${message}\n`));
    });
  }
}
