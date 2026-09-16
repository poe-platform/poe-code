import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { primaryJobReference } from "../shell/extensions/jobs/primary53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

async function setup() {
  const published = await import("poe-code/safe-bash");
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const extension = optional.jobsExtension();
  const fs = createMemoryFileSystem();
  const shell = new published.Shell({ fs, extensions: [extension], limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 } }).use(published.agentCommands());
  return { published, extension, fs, shell };
}

describe("compiled optional background jobs", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("default public entry neither exports jobs nor installs wait", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    context.after(() => shell.dispose());
    assert.equal((published as unknown as Record<string, unknown>).jobsExtension, undefined);
    const result = await shell.exec("wait");
    assert.equal(result.exitCode, 127);
    assert.equal(result.stdout, "");
  });

  test("default public shell keeps asynchronous syntax disabled", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec("true &");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });

  test("optional factory binds wait and its syntax to the public runtime", async context => {
    const subject = await setup();
    context.after(() => subject.shell.dispose());
    assert.equal(subject.extension.runtimeIdentity, subject.published.commandRuntimeIdentity);
    assert.deepEqual(subject.extension.syntax?.listTerminators, [{ operator: "&" }]);
    assert.deepEqual(subject.extension.syntax?.specialParameters, [{ name: "!" }]);
    assert.deepEqual(subject.extension.create().builtins.map(builtin => builtin.name), ["wait"]);
    const result = await subject.shell.exec("type -t wait");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "builtin\n");
    assert.equal(result.stderr, "");
  });

  for (const id of [1, 2, 3, 4, 5, 7, 8, 9, 14]) test(`primary 5.3 ordinary jobs case ${id}`, async context => {
    const expected = primaryJobReference(id);
    assert.equal(expected.requiresController, false);
    const subject = await setup();
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(expected.source, { stdin: expected.stdin, env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, expected.status, expected.name);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout, expected.name);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr, expected.name);
  });

  for (const command of ["bash", "sh"]) test(`${command}: a VFS script launches and waits for an entire AND/OR list`, async context => {
    const expected = primaryJobReference(2);
    const subject = await setup();
    context.after(() => subject.shell.dispose());
    await subject.fs.writeFile("/jobs.sh", new TextEncoder().encode(expected.source));
    const result = await subject.shell.exec(`${command} /jobs.sh`, { stdin: expected.stdin, env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
  });
});
