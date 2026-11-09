import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTacCommand } from "./index.js";

// GNU coreutils tac 9.4, Linux/glibc: C.UTF-8 ranges reject non-ASCII endpoints.
for (const [separator, range, byteOutput] of [
  ["[à-ø]", true, ":Z\xa9X\xc3"],
  ["[é-é]", true, ":Z\xa9X\xc3"],
  ["[a-é]", true, ":Z\xa9X\xc3"],
  ["[é-z]", true, "\xa9:ZX\xc3"],
  ["[^à-ø]", true, "Z\xc3\xa9:X"],
  ["[😀-😀]", true, ":Z\xa9X\xc3"],
  ["[é]", false, ":Z\xa9X\xc3"],
  ["[àéø]", false, ":Z\xa9X\xc3"],
  ["[-é]", false, ":Z\xa9X\xc3"],
  ["[é-]", false, ":Z\xa9X\xc3"],
  ["[a-z]", false, "X\xc3\xa9:Z"],
] as const) {
  for (const locale of ["C.UTF-8", "C"]) {
    test(`tac regex bracket ${separator} in ${locale}`, async () => {
      const values = createCommandArguments(["-rs", separator, "/f"]);
      const stdout: number[] = [], stderr: number[] = [];
      const fs = createMemoryFileSystem();
      await fs.writeFile("/f", new TextEncoder().encode("Xé:Z"));
      const result = await createTacCommand().execute({
        command: "tac", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: locale },
        fs, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr.push(...bytes); } },
        signal: new AbortController().signal,
      });
      const invalid = range && locale === "C.UTF-8";
      assert.equal(result.exitCode, invalid ? 1 : 0);
      assert.deepEqual(stdout, invalid ? [] : locale === "C"
        ? Array.from(byteOutput, character => character.charCodeAt(0))
        : [...new TextEncoder().encode(separator === "[a-z]" ? "Xé:Z" : ":ZXé")]);
      assert.equal(new TextDecoder().decode(Uint8Array.from(stderr)), invalid ? "tac: EINVAL: Invalid collation character\n" : "");
    });
  }
}
