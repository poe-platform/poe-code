import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { shellValueFromBytes } from "safe-bash-contracts/value";
import { createReadlinkCommand } from "./index.js";

test("readlink help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createReadlinkCommand().execute({
  command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const mode of [[], ["-f"], ["-e"], ["-m"]]) {
 for (const byte of [0xff, 0xfe]) {
  test(`readlink ${mode.join(" ")} keeps byte ${byte} distinct from valid UTF-8`, async () => {
   const fs = createMemoryFileSystem();
   await fs.writeFile("/other-target", new Uint8Array());
   await fs.symlink!("other-target", "/�");
   for (const mixed of [false, true]) {
    const values = createCommandArguments([
     ...mode, "--", shellValueFromBytes(Uint8Array.of(byte)),
     ...(mixed ? [shellValueFromBytes(Uint8Array.of(0xef, 0xbf, 0xbd))] : []),
    ]);
    let stdout = "", stderr = "";
    const result = await createReadlinkCommand().execute({
     command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: {},
     fs, stdin: toByteSource(""),
     stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
     stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
     signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, mixed ? `${mode.length ? "/" : ""}other-target\n` : "");
    assert.equal(stderr, "");
   }
  });
 }
}

test("readlink accepts valid UTF-8 replacement characters and preserves a leading BOM", async () => {
 const fs = createMemoryFileSystem();
 await fs.symlink!("replacement", "/�");
 await fs.symlink!("bom", "/\ufeff�");
 const values = createCommandArguments(["�", "\ufeff�"].map(name => shellValueFromBytes(new TextEncoder().encode(name))));
 let stdout = "", stderr = "";
 const result = await createReadlinkCommand().execute({
  command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs, stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0);
 assert.equal(stdout, "replacement\nbom\n");
 assert.equal(stderr, "");
});
