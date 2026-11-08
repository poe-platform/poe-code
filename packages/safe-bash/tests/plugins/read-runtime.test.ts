import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { primaryReference } from "../shell/extensions/read/primary-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = {
  readExtension(options?: { readonly nonTerminalInput?: boolean }): Extension;
  arraysExtension(): Extension;
  createDeviceFileSystem(): import("poe-code/safe-fs").FileSystem;
};

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

async function setup(options: { arrays?: boolean; devices?: boolean; nonTerminalInput?: boolean } = {}) {
  const published = await import("poe-code/safe-bash");
  const filesystem = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const extension = optional.readExtension(options.nonTerminalInput === undefined ? {} : { nonTerminalInput: options.nonTerminalInput });
  const root = filesystem.createMemoryFileSystem();
  const fs = options.devices ? filesystem.createMountFileSystem({ root, mounts: { "/dev": optional.createDeviceFileSystem() } }) : root;
  const shell = new published.Shell({ fs, extensions: [extension, ...(options.arrays ? [optional.arraysExtension()] : [])] }).use(published.agentCommands());
  return { published, extension, shell, fs };
}

const primaryCases = [
  ...["n", "N", "u"].flatMap(flag => ["\\n", "\\r", "\\v", "\\f"].map(space => ({
    name: `decimal -${flag} accepts trailing ${space}`,
    fixture: "review.test.ts",
    script: ` read -${flag} $'${flag === "u" ? "0" : "2"}${space}' value; printf '%s:' "$?"; read -r tail; printf "<%s><%s>" "$value" "$tail"`,
    input: "abcd\n",
  }))),
  { name: "signed decimal accepts C whitespace at both ends", fixture: "review.test.ts", script: ` read -n $'\\t+0002\\r' value; printf '%s:' "$?"; read -r tail; printf "<%s><%s>" "$value" "$tail"`, input: "abcd\n" },
  ...["-0.1", "-.1", "-00.000001", "-0.0000005", "-0.9999999"].map(value => ({
    name: `reject converted negative fractional timeout ${value}`,
    fixture: "timed-review.test.ts",
    script: `value=OLD; read -t '${value}' -n0 value; printf '%s:<%s>;' "$?" "$value"; read -r tail; printf '<%s>' "$tail"`,
    input: "untouched\n",
  })),
  ...["-Q", "--bogus", "-a", "-t"].map(args => ({ name: `primary usage ${args}`, fixture: "native.test.ts", script: `read ${args}`, input: "one\n" })),
  { name: "readonly default REPLY has status two", script: 'readonly REPLY=OLD; read; printf "%s:<%s>" "$?" "$REPLY"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "readonly only scalar retains status one", script: 'readonly first=OLD; read first; printf "%s:<%s>" "$?" "$first"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "readonly non-final scalar has status two", script: 'readonly first=OLD; read first last; printf "%s:<%s><%s>" "$?" "$first" "$last"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "readonly final scalar retains status one", script: 'readonly last=OLD; read first last; printf "%s:<%s><%s>" "$?" "$first" "$last"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "declared nonterminal -E accepts input", script: 'read -E value; printf "%s:<%s>" "$?" "$value"', fixture: "primary53.test.ts", input: "one two\n", nonTerminalInput: true },
];

describe("compiled optional read", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("default public shell retains core read without exporting the extension", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    context.after(() => shell.dispose());
    assert.equal((published as unknown as Record<string, unknown>).readExtension, undefined);
    const result = await shell.exec('read -r value; printf "<%s>" "$value"', { stdin: "one two\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "<one two>");
    assert.equal(result.stderr, "");
  });

  test("optional factory replaces read in the public runtime", async context => {
    const subject = await setup();
    context.after(() => subject.shell.dispose());
    assert.equal(subject.extension.runtimeIdentity, subject.published.commandRuntimeIdentity);
    assert.deepEqual(subject.extension.create().builtins.map(builtin => ({ name: builtin.name, replace: builtin.replace })), [{ name: "read", replace: true }]);
    const result = await subject.shell.exec('type -t read; builtin read -n1 first; command read -n1 second; printf "<%s><%s>" "$first" "$second"', { stdin: "ab" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "builtin\n<a><b>");
    assert.equal(result.stderr, "");
  });

  for (const entry of primaryCases) test(`primary 5.3 bytes: ${entry.name}`, async context => {
    const expected = primaryReference(entry.fixture, entry.script, entry.input);
    const subject = await setup("nonTerminalInput" in entry ? { nonTerminalInput: entry.nonTerminalInput } : {});
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(entry.script, { stdin: Buffer.from(entry.input), env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
  });

  for (const route of ["inline", "bash", "sh"]) {
    test(`${route}: explicit arrays receive split fields`, async context => {
      const subject = await setup({ arrays: true });
      context.after(() => subject.shell.dispose());
      const source = `values=([7]=old); read -r -a values <<'RECORD'\none two three\nRECORD\nprintf '<%s>' "\${values[@]}"; printf '|%s' "\${!values[*]}"`;
      if (route !== "inline") await subject.fs.writeFile("/read.sh", new TextEncoder().encode(source));
      const result = await subject.shell.exec(route === "inline" ? source : `${route} /read.sh`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "<one><two><three>|0 1 2");
      assert.equal(result.stderr, "");
    });

    test(`${route}: descriptor aliases share record consumption`, async context => {
      const subject = await setup();
      context.after(() => subject.shell.dispose());
      await subject.fs.writeFile("/input", new TextEncoder().encode("one\ntwo\n"));
      const source = '{ read -u3 first; read -r -u4 second; printf "<%s><%s>" "$first" "$second"; } 3</input 4<&3';
      if (route !== "inline") await subject.fs.writeFile("/read.sh", new TextEncoder().encode(source));
      const result = await subject.shell.exec(route === "inline" ? source : `${route} /read.sh`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "<one><two>");
      assert.equal(result.stderr, "");
    });
  }

  for (const device of ["null", "zero", "random", "urandom"]) test(`${device}: zero timeout observes readiness without assignment`, async context => {
    const subject = await setup({ devices: true });
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`value=OLD; read -t0 value </dev/${device}; printf '%s:<%s>' "$?" "$value"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0:<OLD>");
    assert.equal(result.stderr, "");
  });

  test("NUL-delimited array input preserves invalid UTF-8 bytes", async context => {
    const subject = await setup({ arrays: true });
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`read -r -d '' -a values; printf '%s' "\${values[@]}"`, { stdin: Uint8Array.of(255, 32, 254, 0) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
    assert.equal(result.stderr, "");
  });
});
