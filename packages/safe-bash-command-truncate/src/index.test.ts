import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTruncateCommand, truncateCommand } from "./index.js";

for (const [profile, factory] of [["portable", createTruncateCommand], ["retained", truncateCommand]] as const) {
 test(`truncate ${profile} treats explicit undefined quotas as omitted`, () => {
  assert.doesNotThrow(() => factory({ limits: { maxArgumentBytes: undefined, maxArguments: undefined, maxOutputBytes: undefined, maxEntries: undefined } }));
  assert.throws(() => factory({ limits: { maxArgumentBytes: 0 } }), RangeError);
 });
 test(`truncate ${profile} admits more than 4096 arguments unless explicitly bounded`, async () => {
  const values = createCommandArguments(["-c", "-s", "0", ...Array.from({ length: 4096 }, (_, index) => `/missing-${index}`)]);
  for (const maxArguments of [undefined, Infinity, values.args.length, values.args.length - 1]) {
   let diagnostic = "";
   const result = await factory(maxArguments === undefined ? {} : { limits: { maxArguments } }).execute({
    command: "truncate", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() { assert.fail("truncate should not produce output"); } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
   });
   if (maxArguments === values.args.length - 1) {
    assert.equal(result.exitCode, 1);
    assert.match(diagnostic, /argument.*limit exceeded/);
   } else {
    assert.equal(result.exitCode, 0, diagnostic);
    assert.equal(diagnostic, "");
   }
  }
 });
}

test("truncate help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createTruncateCommand().execute({
  command: "truncate", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
