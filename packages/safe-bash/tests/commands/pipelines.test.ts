import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { fixture } from "./helpers.js";

test("standard tools compose in a filtering, transforming, sorting and tee pipeline", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
  const result = await shell.exec("printf '%s\\n' keep:pear skip:bad keep:apple keep:pear keep:kiwi | grep '^keep:' | cut -d : -f 2 | tr 'a-z' 'A-Z' | sort | uniq | tee result.txt | wc -l");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "3\n");
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/result.txt")), "APPLE\nKIWI\nPEAR\n");
});

test("filesystem tools combine with find -print0 and xargs without reparsing filenames", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
  const result = await shell.exec("mkdir -p data; printf 'alpha\\nbeta\\n' >'data/a;literal.txt'; cp 'data/a;literal.txt' 'data/b file.txt'; find data -type f -name '*.txt' -print0 | xargs -0 -n 1 cat | sort | uniq -c");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "      2 alpha\n      2 beta\n");
  assert.equal(result.stderr, "");
});

test("xargs and env invoke shell functions while retaining literal argv and isolated environment", async () => {
  const fs = await fixture();
  const visited: string[] = [];
  const shell = new Shell({ fs, cwd: "/work", env: { VALUE: "parent" } }).use(standardCommands());
  shell.use(async (context, next) => { visited.push(context.command); return next(); });
  const result = await shell.exec("report() { printf '%s|%s\\n' \"$VALUE\" \"$1\"; }; printf 'literal;*\\n' | xargs -I '{}' env VALUE=child report '{}'; printf '%s\\n' \"$VALUE\"");
  assert.equal(result.stdout, "child|literal;*\nparent\n");
  assert.equal(result.exitCode, 0);
  assert(visited.includes("env"));
  assert(visited.includes("report"));
});

test("find -exec passes command option-looking arguments literally through the shell hook", async () => {
  const fs = await fixture({ "some file": "x" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
  const result = await shell.exec("find . -type f -exec printf '%s|%s\\n' -maxdepth '{}' ';'");
  assert.equal(result.stdout, "-maxdepth|./some file\n");
  assert.equal(result.exitCode, 0);
});

test("pipeline bytes stay binary and sequential commands do not replay stdin", async () => {
  const fs = await fixture({ first: "file\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
  const binary = await shell.exec("printf '%b' '\\000\\0377\\n' | tee bytes | head -c 2");
  assert.deepEqual(binary.stdoutBytes, Uint8Array.of(0, 255));
  assert.equal(binary.exitCode, 0);
  const shared = await shell.exec("cat <first; cat; cat", { stdin: "parent\n" });
  assert.equal(shared.stdout, "file\nparent\n");
});

test("recursive tool invocation shares shell command limits", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
  await assert.rejects(shell.exec("printf 'one two three' | xargs -n 1 echo", { limits: { maxCommands: 3 } }), error => error instanceof ShellLimitError);
});
