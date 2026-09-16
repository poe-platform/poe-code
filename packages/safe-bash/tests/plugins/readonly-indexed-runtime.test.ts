import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { arraysExtension(): Extension };
type Record = {
  readonly id: string;
  readonly args: readonly [string, string, string, string, string];
  readonly inputHex: string;
  readonly expected: { readonly status: number; readonly stdoutHex: string; readonly stderrHex: string };
};

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled optional readonly indexed declarations", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  const referenceURL = new URL("../shell/extensions/arrays/readonly-indexed-review-reference.json", import.meta.url);
  const metadata = lstatSync(referenceURL);
  assert.ok(metadata.isFile() && metadata.size <= 128 * 1024);
  const bytes = readFileSync(referenceURL);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "f71eeae3dce837d844d7a4b82fffc61a5b953201f879487e6ce02ab20b3dd3b1");
  const reference = JSON.parse(bytes.toString()) as { readonly records: readonly Record[] };
  assert.equal(reference.records.length, 24);
  assert.equal(new Set(reference.records.map(record => record.id)).size, 24);

  for (const record of reference.records) {
    test(`primary Bash 5.3 public replay ${record.id}`, async context => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const extension = optional.arraysExtension();
      assert.equal(extension.runtimeIdentity, published.commandRuntimeIdentity);
      const shell = new published.Shell({
        fs: createMemoryFileSystem(), extensions: [extension],
        limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 128 },
      }).use(published.agentCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(record.args[3], { stdin: Buffer.from(record.inputHex, "hex"), env: { LC_ALL: "C" } });
      assert.deepEqual({
        status: result.exitCode,
        stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"),
        stderrHex: Buffer.from(result.stderrBytes).toString("hex"),
      }, {
        status: record.expected.status,
        stdoutHex: record.expected.stdoutHex,
        stderrHex: record.expected.stderrHex,
      });
    });
  }

  for (const profile of ["default", "name-only", "array-keys-only"] as const) {
    test(`${profile} does not acquire indexed readonly declarations`, async context => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      assert.equal(Object.hasOwn(published, "arraysExtension"), false);
      const extensions: Extension[] = profile === "default" ? [] : [{
        name: "arrays", runtimeIdentity: published.commandRuntimeIdentity,
        ...(profile === "array-keys-only" ? { syntax: { arrayKeys: true as const } } : {}),
        create: () => ({ builtins: [] }),
      }];
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions }).use(published.agentCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec("readonly -a values=(one two); printf UNEXPECTED");
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
    });
  }

  for (const record of [
    {
      name: "replacement skips its list and resumes the next input unit",
      source: "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf after",
      stdout: "after",
      stderr: "shell: line 1: values: readonly variable\n",
    },
    {
      name: "append preserves failure status and original value for the next input unit",
      source: 'readonly -a values=(one)\nreadonly -a values+=(two)\nprintf \'status=%s:<%s>\' "$?" "$values"',
      stdout: "status=1:<one>",
      stderr: "shell: line 2: values: readonly variable\n",
    },
    {
      name: "eval-created readonly bindings retain unprefixed diagnostics across input units",
      source: `eval 'readonly -a values=(one); readonly -a values=(two); printf skip
printf "first:%s;" "$?"
readonly -a values+=(three); printf skip
printf "second:%s;" "$?"'; printf 'outer:%s' "$?"`,
      stdout: "first:1;second:1;outer:0",
      stderr: "shell: line 1: values: readonly variable\nshell: line 3: values: readonly variable\n",
    },
    {
      name: "nested function declarations retain unprefixed caller-local diagnostics",
      source: 'values=outer; f() { local -a values; values=(local); g() { readonly -a values; readonly -a values=(bad); printf skip; }; g; printf skip; }; f; printf skip\nvalues=after; printf "%s" "$values"',
      stdout: "after",
      stderr: "shell: line 1: values: readonly variable\n",
    },
    ...([["[[ yes ]]", "[["], ["((1))", "(("], ["((0))", "(("]] as const).map(([transition, identity]) => ({
      name: `${transition} replaces the function diagnostic identity`,
      source: `readonly -a values=(one); f() { ${transition}; readonly -a values=(two); }; f\nprintf after`,
      stdout: "after",
      stderr: `shell: line 1: ${identity}: values: readonly variable\n`,
    })),
  ]) {
    test(`compiled primary Bash 5.3: ${record.name}`, async context => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [optional.arraysExtension()] }).use(published.agentCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(record.source, { env: { LC_ALL: "C" } });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 0, stdout: record.stdout, stderr: record.stderr,
      });
    });
  }
});
