import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createDiffPatchCommands } from "../../src/commands/diff-patch/index.js";
import { agentCommands } from "../../src/plugins/index.js";

function createShell(): Shell {
  return new Shell({
    fs: new MemoryFileSystem(),
    commands: new CommandRegistry([...createStandardCommands(), ...createDiffPatchCommands()]),
  });
}

describe("process substitution", () => {
  for (const [script, stdout] of [
    ["exec 3> >(tr a-z A-Z); echo via3 >&3; exec 3>&-", "VIA3\n"],
    ["exec > >(tr a-z A-Z) 2>&1; echo hello; echo err >&2", "HELLO\nERR\n"],
    ["exec 3> >(tr a-z A-Z); echo via3 >&3; exec 3>&-; sleep 0.1; exec > >(tr a-z A-Z) 2>&1; echo hello; echo err >&2; sleep 0.1", "VIA3\nHELLO\nERR\n"],
    ["exec 3> >(tr a-z A-Z); exec 4>&3; exec 3>&-; echo duplicate >&4; exec 4>&-; echo done", "DUPLICATE\ndone\n"],
    ["exec 3> >(tr a-z A-Z); echo replaced >&3; exec 3>/dev/null; echo done", "REPLACED\ndone\n"],
  ] as const) {
    it(`retains process substitutions for exec descriptors: ${script}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(script);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
      assert.equal(result.exitCode, 0);
    });
  }

  it("logs later stdout and stderr through exec tee redirection", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec('echo previous >log; exec > >(tee -a log) 2>&1; echo hello; echo err >&2');
    assert.equal(result.stdout, "hello\nerr\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/log")), "previous\nhello\nerr\n");
  });

  for (const [script, stdout] of [
    ["exec 3> >(tr a-z A-Z); echo via3 >&3; exec 3>&-", "VIA3\n"],
    ["exec > >(tr a-z A-Z) 2>&1; echo hello; echo err >&2", "HELLO\nERR\n"],
    ["exec 3> >(tr a-z A-Z); echo via3 >&3; exec 3>&-; sleep 0.1; exec > >(tr a-z A-Z) 2>&1; echo hello; echo err >&2; sleep 0.1", "VIA3\nHELLO\nERR\n"],
    ["exec 3> >(tr a-z A-Z); exec 4>&3; exec 3>&-; echo alias >&4; exec 4>&-", "ALIAS\n"],
    ["exec 3> >(tr a-z A-Z); echo first >&3; exec 3>/dev/null; echo second >&3", "FIRST\n"],
    ['exec {out}> >(tr a-z A-Z); echo named >&"$out"; exec {out}>&-', "NAMED\n"],
    ["(exec > >(tr a-z A-Z); echo inner) | cat", "INNER\n"],
    ["f(){ exec 3> >(tr a-z A-Z); }; f; echo function >&3; exec 3>&-", "FUNCTION\n"],
    ['f(){ local label=before; exec 3> >(read -r line; echo "$label:$line"); }; f; label=after; echo payload >&3; exec 3>&-', "before:payload\n"],
    ["exec > >(tr a-z A-Z); echo first; exec > >(tr A-Z a-z); echo SECOND", "FIRST\nSECOND\n"],
  ] as const) {
    it(`retains exec process substitutions until their descriptors close: ${script}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(script);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
      assert.equal(result.exitCode, 0);
    });
  }

  it("flushes exec process substitutions on explicit shell exit", async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    const result = await shell.exec("exec > >(tr a-z A-Z); echo before; exit 7");
    assert.equal(result.stdout, "BEFORE\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 7);
  });

  it("logs later stdout and stderr through exec and tee", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work", { recursive: true });
    await fs.writeFile("/work/log", new TextEncoder().encode("existing\n"));
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec('exec > >(tee -a log) 2>&1; echo hello; echo err >&2');
    assert.equal(result.stdout, "hello\nerr\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/log")), "existing\nhello\nerr\n");
    assert.deepEqual(await fs.readdir("/tmp"), []);
  });

  for (const [script, stdout] of [
    ["echo a > >(cat) | cat; echo st=$?", "a\nst=0\n"],
    ["echo a | tee >(sed s/a/b/) >/dev/null | cat; echo st=$?", "b\nst=0\n"],
  ] as const) {
    it(`preserves inherited pipeline output: ${script}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(script);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
      assert.equal(result.exitCode, 0);
    });
  }

  it("supports <(cmd) as command arguments (e.g. diff)", async () => {
    const shell = createShell();
    const result = await shell.exec("diff <(printf \"a\\n\") <(printf \"b\\n\")");
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /< a/);
    assert.match(result.stdout, /> b/);
  });

  it("supports < <(cmd) input redirection into while read loop without subshell scope loss", async () => {
    const shell = createShell();
    const result = await shell.exec("while read -r x; do y=\"$x\"; done < <(printf \"hello\\n\"); printf \"%s\\n\" \"$y\"");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello\n");
    assert.equal(result.stderr, "");
  });

  it("supports >(cmd) output process substitution via redirection", async () => {
    const shell = createShell();
    const result = await shell.exec("printf \"hello\\n\" > >(tr a-z A-Z)");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "HELLO\n");
    assert.equal(result.stderr, "");
  });

  it("supports >(cmd) as a command argument (e.g. tee)", async () => {
    const shell = createShell();
    const result = await shell.exec("printf \"world\\n\" | tee >(tr a-z A-Z) >/dev/null");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "WORLD\n");
    assert.equal(result.stderr, "");
  });

  it("supports nested process substitutions and cleans up temporary files", async () => {
    const shell = createShell();
    const result = await shell.exec("cat <(cat <(printf \"nested\\n\")); ls -a /");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.startsWith("nested\n"), true);
    assert.equal(result.stdout.includes(".procsub-"), false);
  });
});
