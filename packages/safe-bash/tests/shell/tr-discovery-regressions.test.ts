import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

for (const [name, setup, body] of [
  ["bare output redirection", "", "> /out"],
  ["bare input redirection", "", "< /dev/null"],
  ["PATH file discovery", "", 'echo "" > /bin/mytool; echo "$(command -v mytool)"'],
  ["PATH directory discovery", "", 'mkdir -p /bin/mytool; echo "$(type -t mytool)"'],
  ["Unicode file content", "echo hi > /f;", 'echo "café" > /f; echo "$(cat /f)"'],
  ["large file content", "echo hi > /f;", 'printf "%17000s" x > /f; echo "$(cat /f)"'],
  ["Unicode word count", 's="hi";', 's="café"; echo "$(wc -w <<< "$s")"'],
] as const) {
  for (const loop of ["for i in 1 2", "for ((i=0;i<2;i++))", "i=0; while ((i++<2))"]) {
    test(`loop admission survives ${name}: ${loop}`, async context => {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/bin");
      const shell = new Shell({ fs, env: { PATH: "/bin" } }).use(standardCommands());
      context.after(() => shell.dispose());
      const source = `${setup} ${loop}; do ${body}; done`;
      const expected = name === "Unicode word count"
        // BSD wc pads its count; compare the numeric result in GNU-style output.
        ? spawnSync("/bin/bash", ["-c", source.replace('echo "$(wc', 'printf "%d\\n" "$(wc')], { encoding: "utf8" })
        : undefined;
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected?.stdout ?? (name === "Unicode file content" ? "café\ncafé\n" : name === "large file content" ? `${" ".repeat(16999)}x\n`.repeat(2) : name.startsWith("PATH") ? "\n\n" : ""));
      if (name === "bare output redirection") assert.equal((await fs.readFile("/out")).byteLength, 0);
    });
  }
}
import { Shell } from "../../src/shell/index.js";

for (const form of ["assignment", "inline"] as const) for (const [set, expected] of [["0-9", "abcdefXYZ-"], ["a-z", "123XYZ-"], ["A-Z", "abc123def-"], ["a-f", "123XYZ-"], ["-", "abc123defXYZ"], ["[:digit:]", "abcdefXYZ-"]] as const) {
  test(`substitution tr deletion preserves set semantics (${form}): ${set}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const pipeline = `$(printf 'abc123defXYZ-\\n' | tr -d '${set}')`;
    const result = await shell.exec(form === "assignment" ? `x=${pipeline}; printf '%s\\n' "$x"` : `echo "${pipeline}"`);
    assert.equal(result.stdout, `${expected}\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("discovery survives unrelated memory symlinks in direct and substituted calls", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { PATH: "/bin" } }).use(standardCommands());
  context.after(() => shell.dispose());
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/mytool", new TextEncoder().encode(":"), { mode: 0o755 });
  await fs.symlink("/missing", "/unrelated");
  for (const command of ["command -v mytool", "type -t mytool", 'printf "%s\\n" "$(command -v mytool)"', 'printf "%s\\n" "$(type -t mytool)"']) {
    const result = await shell.exec(command);
    assert.equal(result.stdout, command.includes("type -t") ? "file\n" : "/bin/mytool\n");
    assert.equal(result.exitCode, 0);
  }
});
