import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

for (const serial of [false, true]) {
 for (const locale of ["C.UTF-8", "C"]) {
  for (const [name, displayed] of [
   ["x\u2028y", "'x'$'\\342\\200\\250''y'"],
   ["x\u2029y", "'x'$'\\342\\200\\251''y'"],
   ["x\u0378y", "'x'$'\\315\\270''y'"],
   ["x\u009fy", "'x'$'\\302\\237''y'"],
   ["x \u2028y", "'x '$'\\342\\200\\250''y'"],
   ["x \u2029y", "'x '$'\\342\\200\\251''y'"],
   ["x \u0378y", "'x '$'\\315\\270''y'"],
   ["x'\u2028y", "'x'\\'''$'\\342\\200\\250''y'"],
   ["\u2028", "''$'\\342\\200\\250'"],
   ["café", locale === "C" ? "'caf'$'\\303\\251'" : "café"],
  ] as const) {
   test(`paste filename diagnostic bytes: ${JSON.stringify({ name, locale, serial })}`, async () => {
    const values = createCommandArguments(serial ? ["-s", name] : [name]);
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const result = await createPasteCommand().execute({
     command: "paste", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: locale },
     fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
     stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
     stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(Buffer.concat(stdout), Buffer.alloc(0));
    assert.deepEqual(Buffer.concat(stderr), Buffer.from(`paste: ${displayed}: No such file or directory\n`));
   });
  }
 }
 for (const name of ["x\u2028y", "x\u2029y", "x\u0378y", "x\u009fy", "café"]) {
  test(`paste opens the original Unicode filename: ${JSON.stringify({ name, serial })}`, async () => {
   const fs = createMemoryFileSystem();
   await fs.writeFile(`/${name}`, Buffer.from("first\nsecond\n"));
   const values = createCommandArguments(serial ? ["-s", name] : [name]);
   const stdout: Buffer[] = [], stderr: Buffer[] = [];
   const result = await createPasteCommand().execute({
    command: "paste", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C.UTF-8" },
    fs, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
   });
   assert.equal(result.exitCode, 0);
   assert.deepEqual(Buffer.concat(stdout), Buffer.from(serial ? "first\tsecond\n" : "first\nsecond\n"));
   assert.deepEqual(Buffer.concat(stderr), Buffer.alloc(0));
  });
 }
}
