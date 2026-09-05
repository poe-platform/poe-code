import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const definition = "origin() {\n:\nmissing_origin_command;\n}\n";

describe("compiled GNU Bash 5.3 function diagnostic origins", { skip: selected === undefined ? "Requires a current build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["probe", "command probe", "builtin probe"]) {
    test(`sourced function retains its declaration origin through ${route}`, async context => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const fs = createMemoryFileSystem();
      await fs.mkdir("/dev/fd", { recursive: true });
      await fs.writeFile("/dev/fd/3", Buffer.from(definition));
      const shell = new published.Shell({ fs, extensions: [{
        name: "diagnostic-origin", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "probe", execute(invocation) { return invocation.evaluate("origin"); } }] }),
      }] }).use(published.agentCommands());
      context.after(() => shell.dispose());
      const source = `. /dev/fd/3 3<<'ORIGIN'\n${definition}ORIGIN\n:\n:\n`;
      const actual = await shell.exec(`${source}${route}; printf 'status=%s' "$?"`);
      assert.equal(actual.exitCode, 0);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from("status=127"));
      assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.from("/dev/fd/3: line 3: missing_origin_command: command not found\n"));
    });
  }

  test("command-text definitions retain their native function label", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const source = `${definition}:\n:\norigin; printf 'status=%s' "$?"`;
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from("status=127"));
    assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.from("shell: line 3: missing_origin_command: command not found\n"));
  });

  test("stdin definitions retain their native function label", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const source = `${definition}:\n:\neval origin; printf 'status=%s' "$?"`;
    const actual = await shell.exec("bash", { stdin: source });
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from("status=127"));
    assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.from("bash: line 3: missing_origin_command: command not found\n"));
  });

  for (const fixture of [
    { name: "conditional body", body: "fn(){ if true; then missing_coordinate; fi; }; fn", line: 5 },
    { name: "for body", body: "fn(){ for item in one; do missing_coordinate; done; }; fn", line: 6 },
    { name: "while body", body: "fn(){ while true; do missing_coordinate; break; done; }; fn", line: 5 },
    { name: "conditional before declaration", body: "if true; then :; fi; fn(){ missing_coordinate; }; fn", line: 6 },
  ]) test(`substitution reprint retains ${fixture.name} coordinates`, async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(`:\nprintf '%s' "$(${fixture.body})"`);
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.alloc(0));
    assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.from(`shell: line ${fixture.line}: missing_coordinate: command not found\n`));
  });
});
