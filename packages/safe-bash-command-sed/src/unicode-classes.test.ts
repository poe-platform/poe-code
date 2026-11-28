import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSedCommand } from "./index.js";

for (const [program, input, expected] of [
  ["s/\\w*/[&]/", "élan vital", "[élan] vital\n"],
  ["/a\\wb/p;/^[[:alpha:]]\\{3\\}$/p", "aéb", "aéb\naéb\n"],
  ["s/\\b/|/g", "héllo", "|héllo|\n"],
  ["/[[:upper:]]/p", "É", "É\n"],
  ["s/\\W/_/g", "élan!", "élan_\n"],
  ["s/\\B/|/g", "é𐐀", "é|𐐀\n"],
  ["s/\\</[/g;s/\\>/]/g", "é𐐀", "[é𐐀]\n"],
  ["/[[:lower:]]/p", "é", "é\n"],
  ["/^[[:alnum:]]*$/p", "é3", "é3\n"],
  ["/^[[:graph:]]*$/p", "é€", "é€\n"],
  ["/^[[:print:]]*$/p", "é €", "é €\n"],
  ["/[[:punct:]]/p", "€", "€\n"],
  ["/[[:blank:]]/p", "\u2003", "\u2003\n"],
  ["/\\s/p", "\u2003", "\u2003\n"],
  ["/[[:space:]]/p", "\u2003", "\u2003\n"],
  ["/[[:cntrl:]]/p", "\u0085", "\u0085\n"],
  ["/^[[:alpha:]]$/p;/^[[:alnum:]]$/p", "٣", "٣\n٣\n"],
  ["s/\\w/[&]/g", "٣", "[٣]\n"],
  ["/[[:space:]]/p;/[[:blank:]]/p", "\u00a0", ""],
  ["/[[:punct:]]/p", "\u00a0", "\u00a0\n"],
  ["/[[:digit:]]/p;/[[:xdigit:]]/p", "٣", ""],
] as const) {
  test(`C.UTF-8 sed ${program} on ${input}`, async () => {
    const args = [...(program.startsWith("s/") ? [] : ["-n"]), program];
    const values = createCommandArguments(args);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createSedCommand().execute({
      command: "sed", args: values.args, argumentValues: values,
      cwd: "/work", env: { LC_ALL: "C.UTF-8" }, fs: createMemoryFileSystem(),
      stdin: toByteSource(input + "\n"), signal: new AbortController().signal,
      stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(stderr).toString(), "");
    assert.equal(Buffer.concat(stdout).toString(), expected);
  });
}
