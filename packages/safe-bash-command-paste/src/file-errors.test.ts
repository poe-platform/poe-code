import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

for (const [args, stdout, stderr, exitCode] of [
 [["-s", "a", "missing file", "b"], "A\tB\tC\n1\t2\n", "paste: 'missing file': No such file or directory\n", 1],
 [["a", "b", "missing file"], "", "paste: 'missing file': No such file or directory\n", 1],
 [["-s", "dir", "a"], "\nA\tB\tC\n", "paste: dir: Is a directory\n", 1],
 [["a/", "b"], "", "paste: a/: Not a directory\n", 1],
 [["a", "b"], "A\t1\nB\t2\nC\t\n", "", 0],
 [["-s", "a/", "b"], "1\t2\n", "paste: a/: Not a directory\n", 1],
 [["./dir", "b"], "\t1\n\t2\n", "paste: ./dir: Is a directory\n", 1],
 [["./missing"], "", "paste: ./missing: No such file or directory\n", 1],
 [["dir", "missing file"], "", "paste: 'missing file': No such file or directory\n", 1],
 [["a:b"], "", "paste: 'a:b': No such file or directory\n", 1],
 [["can't"], "", "paste: \"can't\": No such file or directory\n", 1],
 [["a\nb"], "", "paste: 'a'$'\\n''b': No such file or directory\n", 1],
 [["a^b"], "", "paste: 'a^b': No such file or directory\n", 1],
 [["a{b}"], "", "paste: a{b}: No such file or directory\n", 1],
] as const) {
 test(`paste C-locale file diagnostics for ${JSON.stringify(args)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new TextEncoder().encode("A\nB\nC"));
  await fs.writeFile("/b", new TextEncoder().encode("1\n2\n"));
  await fs.mkdir("/dir");
  const values = createCommandArguments(args);
  const output = { stdout: "", stderr: "" };
  const result = await createPasteCommand().execute({
   command: "paste", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C" }, fs,
   stdin: toByteSource("x\ny\nz\n"), signal: new AbortController().signal,
   stdout: { async write(bytes) { output.stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { output.stderr += new TextDecoder().decode(bytes); } },
  });
  assert.deepEqual({ ...result, ...output }, { exitCode, stdout, stderr });
 });
}

for (const serial of [false, true]) {
 for (const [env, name, displayed] of [
  [{ LC_ALL: "C.UTF-8" }, "é", "é"],
  [{ LC_ALL: "C.UTF-8" }, "café menu", "'café menu'"],
  [{ LC_ALL: "C.utf8" }, "日本語🙂", "日本語🙂"],
  [{ LANG: "C.UTF-8" }, "é", "é"],
  [{ LANG: "C", LC_CTYPE: "C.UTF-8" }, "é", "é"],
  [{ LC_ALL: "C", LANG: "C.UTF-8" }, "é", "''$'\\303\\251'"],
  [{ LC_ALL: "POSIX" }, "café menu", "'caf'$'\\303\\251'' menu'"],
  [{ LANG: "C.UTF-8", LC_NUMERIC: "invalid" }, "é", "''$'\\303\\251'"],
  [{ LC_ALL: "C.UTF-8" }, "café's", `"café's"`],
  [{ LC_ALL: "C.UTF-8" }, "é\nmenu", "'é'$'\\n''menu'"],
  [{ LC_ALL: "C.UTF-8" }, "é\u009b", "'é'$'\\302\\233'"],
 ] as const) {
  test(`paste ${serial ? "serial" : "parallel"} file diagnostics for ${JSON.stringify({ env, name })}`, async () => {
   const values = createCommandArguments(serial ? ["-s", name] : [name]);
   const output = { stdout: "", stderr: "" };
   const result = await createPasteCommand().execute({
    command: "paste", args: values.args, argumentValues: values, cwd: "/", env,
    fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { output.stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { output.stderr += new TextDecoder().decode(bytes); } },
   });
   assert.deepEqual({ ...result, ...output }, {
    exitCode: 1, stdout: "", stderr: `paste: ${displayed}: No such file or directory\n`,
   });
  });
 }
}
