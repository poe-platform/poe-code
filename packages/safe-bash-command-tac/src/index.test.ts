import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTacCommand } from "./index.js";

for (const { name, args, input, output = "", exitCode = 0, error = "" } of [
 ...["s", "se", "sep", "sepa", "separ", "separa", "separat", "separato", "separator"].flatMap(name => [
  { exitCode: 0, error: "", name: `accepts --${name} with an attached separator`, args: [`--${name}=:`], input: "Xé:Z", output: "ZXé:" },
  { exitCode: 0, error: "", name: `accepts --${name} with a separate separator`, args: [`--${name}`, "é"], input: "XéZ", output: "ZXé" },
 ]),
 ...["b", "be", "bef", "befo", "befor", "before"].map(name => (
  { exitCode: 0, error: "", name: `accepts --${name}`, args: [`--${name}`, "-s", ":"], input: "Xé:Z", output: ":ZXé" }
 )),
 ...["r", "re", "reg", "rege", "regex"].map(name => (
  { exitCode: 0, error: "", name: `accepts --${name}`, args: [`--${name}`, "-s", "[,:]"], input: "Xé:Z,Q", output: "QZ,Xé:" }
 )),
 { name: "rejects unknown long options", args: ["--sepx=:"], input: "Xé:Z", exitCode: 1, error: "unrecognized option" },
 { name: "rejects an empty long option name", args: ["--=:"], input: "Xé:Z", exitCode: 1, error: "unrecognized option" },
 { name: "requires an abbreviated separator argument", args: ["--sep"], input: "Xé:Z", exitCode: 1, error: "requires an argument" },
 { name: "rejects values on abbreviated flags", args: ["--bef=yes"], input: "Xé:Z", exitCode: 1, error: "does not take an argument" },
 { name: "accepts an attached Unicode abbreviated separator", args: ["--sep=é"], input: "XéZ", output: "ZXé" },
 { name: "rejects an empty regex separator on binary input", args: ["-r", "-s", ""], input: "a\0b", exitCode: 1, error: "separator cannot be empty" },
 { name: "rejects an empty regex separator on text input", args: ["-r", "-s", ""], input: "ab", exitCode: 1, error: "separator cannot be empty" },
 { name: "rejects an empty regex separator on empty input", args: ["-r", "-s", ""], input: "", exitCode: 1, error: "separator cannot be empty" },
 { name: "validates the separator after the regex flag", args: ["-s", "", "-r"], input: "a\0b", exitCode: 1, error: "separator cannot be empty" },
 { name: "rejects an empty long regex separator", args: ["--regex", "--separator="], input: "a\0b", exitCode: 1, error: "separator cannot be empty" },
 { name: "rejects an empty regex separator before opening files", args: ["-rs", "", "/missing"], input: "", exitCode: 1, error: "separator cannot be empty" },
 { name: "keeps an empty literal separator as NUL", args: ["-s", ""], input: "a\0b", output: "ba\0" },
 { name: "preserves input when a nonempty regex does not match", args: ["-r", "-s", "x"], input: "a\0b", output: "a\0b" },
 { name: "uses the final separator when an empty one is replaced", args: ["-r", "-s", "", "-s", "x"], input: "axb", output: "bax" },
 { name: "rejects a final empty regex separator", args: ["-r", "-s", "x", "-s", ""], input: "axb", exitCode: 1, error: "separator cannot be empty" },
]) {
 test(`tac ${name}`, async () => {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createTacCommand().execute({
   command: "tac", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(input),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, exitCode);
  assert.equal(stdout, output);
  if (error) assert.ok(stderr.includes(error), stderr);
  else assert.equal(stderr, "");
 });
}

for (const before of [false, true]) {
 for (const [env, unicode] of [
  [{ LC_ALL: "C.UTF-8", LC_CTYPE: "C" }, true],
  [{ LC_CTYPE: "C.utf8", LANG: "C" }, true],
  [{ LANG: "en_US.UTF-8" }, true],
  [{ LC_ALL: "C", LANG: "en_US.UTF-8" }, false],
  [{ LC_CTYPE: "POSIX", LANG: "en_US.UTF-8" }, false],
  [{}, false],
 ] as const) {
  test(`tac regex dot preserves locale character boundaries: before=${before}, ${JSON.stringify(env)}`, async () => {
   const values = createCommandArguments([...(before ? ["-b"] : []), "-r", "-s", "."]);
   const output: number[] = [], errors: number[] = [];
   const result = await createTacCommand().execute({
    command: "tac", args: values.args, argumentValues: values, cwd: "/", env,
    fs: createMemoryFileSystem(), stdin: toByteSource("Aé😀B"),
    stdout: { async write(bytes) { output.push(...bytes); } },
    stderr: { async write(bytes) { errors.push(...bytes); } },
    signal: new AbortController().signal,
   });
   assert.equal(result.exitCode, 0);
   assert.deepEqual(errors, []);
   assert.deepEqual(output, unicode
    ? [...new TextEncoder().encode("B😀éA")]
    : [...new TextEncoder().encode("Aé😀B")].reverse());
  });
 }
}

for (const [args, input, expected] of [
 [["-s", "é"], [65, 195, 169, 66], [66, 65, 195, 169]],
 [["-r", "-s", "é"], [65, 195, 169, 66], [66, 65, 195, 169]],
 [["-r", "-s", "."], [65, 255, 66], [255, 66, 65]],
 [[], [65, 255, 10, 66, 10], [66, 10, 65, 255, 10]],
 [["-r", "-s", "."], [65, 10, 66, 10], [10, 10, 66, 65]],
] as const) {
 test(`tac preserves separator and raw-byte behavior: ${JSON.stringify(args)}, ${input}`, async () => {
  const values = createCommandArguments([...args]);
  const output: number[] = [], errors: number[] = [];
  const result = await createTacCommand().execute({
   command: "tac", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C.UTF-8" },
   fs: createMemoryFileSystem(), stdin: toByteSource(Uint8Array.from(input)),
   stdout: { async write(bytes) { output.push(...bytes); } },
   stderr: { async write(bytes) { errors.push(...bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(output, expected);
 });
}

test("tac help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createTacCommand().execute({
  command: "tac", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
