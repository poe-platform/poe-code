import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createLsCommand } from "./index.js";

async function list(args: string[], name = "a b", env: Record<string, string> = { LC_ALL: "C.UTF-8" }) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/data");
  await fs.writeFile(`/data/${name}`, new Uint8Array());
  let stdout = "", stderr = "";
  const context: CommandContext = {
    command: "ls", args, cwd: "/data", env, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  };
  const result = await createLsCommand().execute(context);
  return { ...result, stdout, stderr };
}

for (const [style, expected] of [
  ["literal", "a b"], ["escape", "a\\ b"], ["shell", "'a b'"],
  ["shell-always", "'a b'"], ["shell-escape", "'a b'"], ["shell-escape-always", "'a b'"],
  ["c", '"a b"'], ["c-maybe", "a b"], ["locale", "‘a b’"], ["clocale", "‘a b’"],
]) test(`ls quoting style ${style}`, async () => {
  assert.deepEqual(await list([`--quoting-style=${style}`]), { exitCode: 0, stdout: `${expected}\n`, stderr: "" });
});

test("ls quotes controls, quotes, backslashes and Unicode", async () => {
  for (const [style, name, expected] of [
    ["escape", "a\tb\nc\x07\\é", "a\\tb\\nc\\a\\\\é"],
    ["c", "a\"b\nc\\é", '"a\\"b\\nc\\\\é"'],
    ["shell", "a'b", '"a\'b"'],
    ["shell", "a'$b", "'a'\\''$b'"],
    ["shell", "a\nb", "'a\nb'"],
    ["shell-escape", "a\nb", "'a'$'\\n''b'"],
    ["shell", "c", "c"], ["shell-always", "c", "'c'"],
    ["c-maybe", "a\\b", "a\\b"], ["c-maybe", "a\nb", '"a\\nb"'],
  ]) assert.equal((await list([`--quoting-style=${style}`], name)).stdout, expected + "\n");
  assert.equal((await list(["-b"], "é", { LC_ALL: "C" })).stdout, "\\303\\251\n");
});

test("ls quoting options use the last selection and preserve -- operands", async () => {
  for (const args of [["-Qb"], ["--quote-name", "--escape"], ["-N", "--quoting-style", "esc"]]) {
    assert.equal((await list(args)).stdout, "a\\ b\n");
  }
  for (const args of [["-bN"], ["--quoting-style=c", "--literal"]]) {
    assert.equal((await list(args)).stdout, "a b\n");
  }
  assert.equal((await list(["--", "--escape"], "--escape")).stdout, "--escape\n");
  for (const args of [["--quoting-style"], ["--quoting-style=wrong"], ["--quoting-style="], ["--quoting-style=s"]]) {
    const result = await list(args);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("quoting-style"));
  }
});
