import assert from "node:assert/strict";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { mapfileExtension(): Extension; arraysExtension(): Extension; trapExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

async function setup(extra: readonly ("arraysExtension" | "trapExtension")[] = []) {
  const published = await import("poe-code/safe-bash");
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const extension = optional.mapfileExtension();
  const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [extension, ...extra.map(name => optional[name]())] }).use(published.agentCommands());
  return { published, extension, shell };
}

describe("compiled optional mapfile", { skip: selected === undefined ? "Requires a current optional build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("default public shell does not install or export mapfile", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    context.after(() => shell.dispose());
    assert.equal((published as unknown as Record<string, unknown>).mapfileExtension, undefined);
    const result = await shell.exec("mapfile rows");
    assert.equal(result.exitCode, 127);
    assert.equal(result.stdout, "");
  });

  test("optional factory binds both builtin names to the public runtime", async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    assert.equal(subject.extension.runtimeIdentity, subject.published.commandRuntimeIdentity);
    assert.deepEqual(subject.extension.create().builtins.map(builtin => builtin.name), ["mapfile", "readarray"]);
    const result = await subject.shell.exec("type -t mapfile; type -t readarray");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "builtin\nbuiltin\n");
    assert.equal(result.stderr, "");
  });

  for (const builtin of ["mapfile", "readarray"]) test(`${builtin} publishes records and enables array keys`, async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`${builtin} -t rows <<'RECORDS'\na\nb\nRECORDS\nprintf '<%s>' "\${rows[@]}"; printf '|%s' "\${!rows[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<a><b>|0 1");
    assert.equal(result.stderr, "");
  });

  test("NUL-delimited records retain raw bytes through public bindings", async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`mapfile -d '' -t rows; printf '%s' "\${rows[@]}"`, { stdin: Uint8Array.of(255, 0, 254, 0) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
    assert.equal(result.stderr, "");
  });

  test("primary numeric whitespace preserves the unread input tail", async context => {
    const subject = await setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`mapfile -t -n $'1\\r' rows; read -r remainder; printf '<%s>|%s' "\${rows[@]}" "$remainder"`, { stdin: "one\ntwo\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("<one>|two"));
    assert.equal(result.stderr, "");
  });

  test("sparse uint32 publication composes with the explicit array extension", async context => {
    const subject = await setup(["arraysExtension"]); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`rows=([2]=old); mapfile -t -O4294967294 rows <<'RECORDS'\nx\ny\nRECORDS\nprintf '<%s>' "\${rows[@]}"; printf '|%s' "\${!rows[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<old><x><y>|2 4294967294 4294967295");
    assert.equal(result.stderr, "");
  });

  test("callback exit preserves raw locals for the optional EXIT handler", async context => {
    const subject = await setup(["trapExtension"]); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`trap 'printf "%s" "$value"' EXIT; value=outer; callback() { local value=$'\\xff'; exit 7; }; mapfile -C callback -c1 rows <<'RECORDS'\nx\nRECORDS\nprintf after`);
    assert.equal(result.exitCode, 7, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
    assert.equal(result.stderr, "");
  });
});
