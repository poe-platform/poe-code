import assert from "node:assert/strict";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type OptionalArrays = {
  Shell: typeof import("poe-code/safe-bash").Shell;
  arraysExtension(): Extension;
};

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

async function setup(enabled = true, extra: readonly Extension[] = []) {
  const published = await import("poe-code/safe-bash");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as OptionalArrays;
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const fs = createMemoryFileSystem();
  const extensions = [...(enabled ? [optional.arraysExtension()] : []), ...extra];
  const shell = new published.Shell({ fs, extensions }).use(published.agentCommands());
  return { published, optional, fs, shell };
}

describe("compiled opt-in array keys", { skip: selected === undefined ? "Requires a current optional build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("optional factory shares runtime identity and installs no commands", async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    const extension = subject.optional.arraysExtension();
    assert.equal(subject.optional.Shell, subject.published.Shell);
    assert.equal(extension.runtimeIdentity, subject.published.commandRuntimeIdentity);
    assert.deepEqual(extension.create().builtins, []);
    assert.equal((subject.published as unknown as Record<string, unknown>).arraysExtension, undefined);
  });

  test("default public shell still refuses key syntax", async context => {
    const subject = await setup(false); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`a=(x y); printf '%s' "\${!a[*]}"`);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });

  test("default public parse errors retain priority over invalid extension names", async context => {
    const subject = await setup(false, [{ name: "", create: () => ({ builtins: [] }) }]);
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec("'unterminated");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "shell: -c: line 1: unexpected EOF while looking for matching `''\n");
    await assert.rejects(subject.shell.exec(":"), { name: "TypeError", message: "Invalid or duplicate shell extension" });
  });

  for (const fixture of [
    { name: "mixed scalar and keys", source: `a=([2]=x [10]=y); raw=$'\\xff'; cat <<DOC\n\${raw}\${!a[*]}\${raw}\nDOC`, hex: "ff32203130ff0a", enabled: true },
    { name: "mixed members and keys", source: `a=([2]=x [10]=y); IFS=$'\\xff'; cat <<DOC\n\${a[*]}:\${!a[*]}\nDOC`, hex: "78ff793a322031300a", enabled: true },
    { name: "default scalar", source: `raw=$'\\xff'; cat <<DOC\n\${raw}\nDOC`, hex: "ff0a", enabled: false },
  ]) test(`public heredoc preserves raw bytes for ${fixture.name}`, async context => {
    const subject = await setup(fixture.enabled); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(fixture.source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(fixture.hex, "hex"));
    assert.equal(result.stderr, "");
  });

  test("writer-created sparse uint32 keys remain numerically ordered", async context => {
    const published = await import("poe-code/safe-bash");
    const writer: Extension = { name: "seed", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "seed", async execute(command) {
        const target = await command.bindings.openIndexed("cells", { clear: true });
        try { for (const index of [4294967295, 0, 2147483648]) await target.set(index, "value"); }
        finally { await target.close(); }
        return 0;
      } }] }),
    };
    const subject = await setup(true, [writer]); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`seed; printf '<%s>' "\${!cells[@]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<0><2147483648><4294967295>");
    assert.equal(result.stderr, "");
  });

  test("quoted star keys retain a raw IFS byte", async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`a=([10]=x [2]=y); IFS=$'\\377'; printf '%s' "\${!a[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(50, 255, 49, 48));
    assert.equal(result.stderr, "");
  });

  const body = `a=([10]=x [2]=y); printf '%s' "\${!a[*]}"`;
  const quotedBody = `'${body.split("'").join("'\\''")}'`;
  const routes = [
    { name: "eval", source: `eval ${quotedBody}`, output: "2 10" },
    { name: "source", source: ". /keys.sh", output: "2 10" },
    { name: "bash command", source: `bash -c ${quotedBody}`, output: "2 10" },
    { name: "sh file", source: "sh /keys.sh", output: "2 10" },
    { name: "substitution", source: `printf '%s' "$(${body})"`, output: "2 10" },
    { name: "heredoc", source: `a=([10]=x [2]=y); cat <<END\n\${!a[*]}\nEND`, output: "2 10\n" },
    { name: "pipeline stdin", source: `printf '%s' ${quotedBody} | bash`, output: "2 10" },
  ];
  for (const route of routes) test(`captured optional grammar reaches public ${route.name}`, async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    await subject.fs.writeFile("/keys.sh", Buffer.from(body));
    const result = await subject.shell.exec(route.source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, route.output);
    assert.equal(result.stderr, "");
  });

  test("captured metadata survives factory mutation and a child fork", async context => {
    const subject = await setup(false);
    context.after(() => subject.shell.dispose());
    const syntax = { arrayKeys: true };
    let reads = 0;
    const definition = subject.optional.arraysExtension();
    const extension = { ...definition, get syntax() { reads++; return syntax as { arrayKeys: true }; }, create() { syntax.arrayKeys = false; return definition.create(); } };
    const shell = new subject.published.Shell({ fs: subject.fs, extensions: [extension] }).use(subject.published.agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`a=(x y); printf '%s|' "\${!a[*]}"; (printf '%s' "\${!a[*]}")`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0 1|0 1");
    assert.equal(result.stderr, "");
    assert.equal(reads, 1);
  });

  test("key expansion uses the shared public output budget", async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    await assert.rejects(subject.shell.exec(body, { limits: { maxOutputBytes: 3 } }), error =>
      error instanceof Error && Reflect.get(error, "limit") === "maxOutputBytes");
  });
});
