import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import * as publicApi from "../../src/index.js";

for (const [name, source, stdout] of [
  ["exec descriptors", "exec 3>/f; echo hi >&3; exec 3>&-; cat /f", "hi\n"],
  ["exec replacement", "(exec echo replaced; echo unreachable); echo parent", "replaced\nparent\n"],
  ["exec empty environment", "export KEEP=secret; exec -c bash -c 'echo \"${KEEP-unset}\"'", "unset\n"],
  ["exec argv0", "exec -a custom bash -c 'echo \"$0\"'", "custom\n"],
  ["read descriptor", "echo hello >/f; { read -r -u 3 x; echo \"$x\"; } 3</f", "hello\n"],
  ["mapfile descriptor", "printf 'one\\ntwo\\n' >/f; { mapfile -t -u 3 a; printf '<%s>\\n' \"${a[@]}\"; } 3</f", "<one>\n<two>\n"],
  ["readarray descriptor", "echo hello >/f; { readarray -t -u 3 a; echo \"${a[0]}\"; } 3</f", "hello\n"],
  ["aliases", "shopt -s expand_aliases\nalias ll='echo aliased'\nll\nunalias ll\nalias ll", "aliased\n"],
  ["caller", "outer() { inner; }\ninner() { caller; caller 0; }\nouter", "1 shell\n1 outer shell\n"],
  ["printf time", "TZ=UTC printf '%(%Y-%m-%d)T\\n' 1700000000", "2023-11-14\n"],
  ["printf strftime dialect", "TZ=UTC printf '%(%Q|%N|%q|%P|%:z|%v|%+)T\\n' 0", "Q|N|q|P|:z| 1-Jan-1970|Thu Jan  1 00:00:00 UTC 1970\n"],
] as const) {
  test(`default shell ${name}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.use(standardCommands());
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout, result.stderr);
      assert.equal(result.exitCode, name === "aliases" ? 1 : 0);
      if (name !== "aliases") assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("read and mapfile extensions are public factories", () => {
  assert.equal(typeof publicApi.readExtension, "function");
  assert.equal(typeof publicApi.mapfileExtension, "function");
});

for (const child of [false, true]) test(`printf time uses current and shell start times independently of SECONDS, child=${child}`, async t => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, "now", () => now);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  shell.register({ name: "advance", execute() { now += 2000; return { exitCode: 0 }; } });
  try {
    const source = "advance; SECONDS=99; printf '%(%s)T %(%s)T %(%s)T\\n' -2 -1; printf -v stamp '%(%Y-%m-%d)T' 1700000000; echo \"$stamp\"";
    const result = await shell.exec(child ? `bash -c '${source.replaceAll("'", "'\\''")}'` : source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "1700000000 1700000002 1700000002\n2023-11-14\n");
  } finally { await shell.dispose(); }
});

test("caller tracks script main, nested functions, sources and subshells", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/script", new TextEncoder().encode("outer() { inner; }\ninner() { caller 0; caller 1; (caller 0); }\nouter\nsource /sourced\ncaller\n"));
  await fs.writeFile("/sourced", new TextEncoder().encode("caller 0\nleaf() { caller 0; caller 1; }\nleaf\n"));
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("bash /script");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "1 outer /script\n3 main /script\n1 outer /script\n4 main /script\n3 source /sourced\n4 main /script\n");
    assert.equal(result.exitCode, 1);
  } finally { await shell.dispose(); }
});

test("mapfile and read share descriptor cursors and reject closed descriptors", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    const result = await shell.exec("printf 'one\\ntwo\\nthree\\n' >/f; exec 3</f; read -u 3 first; mapfile -tn1 -u3 rows; read -u3 last; printf '%s\\n' \"$first\" \"${rows[@]}\" \"$last\"; exec 3<&-; mapfile -u3 rows; echo status:$?; echo \"${rows[@]}\"");
    assert.equal(result.stdout, "one\ntwo\nthree\nstatus:1\ntwo\n");
    assert.match(result.stderr, /Bad file descriptor/);
  } finally { await shell.dispose(); }
});
