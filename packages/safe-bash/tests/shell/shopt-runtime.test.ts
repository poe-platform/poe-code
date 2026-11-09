import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/index.js";
import { MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem } from "@poe-code/safe-fs/core";
import { Shell } from "../../src/shell/shell.js";

test("varredir_close survives snapshots and subshell option changes stay isolated", async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const enabled = await shell.exec("shopt -s varredir_close", { onState() {} });
  assert.equal(enabled.exitCode, 0, enabled.stderr);
  assert.equal(enabled.state?.options?.varredir_close, true);
  const restored = await shell.exec('shopt -p varredir_close; (shopt -u varredir_close); : {out}>log; (say bad >&"$out") 2>/dev/null; say "$?"', { state: enabled.state });
  assert.equal(restored.exitCode, 0, restored.stderr);
  assert.equal(restored.stderr, "");
  assert.equal(restored.stdout, "shopt -s varredir_close\n1\n");
});

test("option variables track set and shopt across shell scopes and sessions", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`echo "$SHELLOPTS|$BASHOPTS"
set -o pipefail
shopt -s nullglob
echo "$SHELLOPTS|$BASHOPTS"
(set +o pipefail; shopt -u nullglob; echo "$SHELLOPTS|$BASHOPTS")
echo "$SHELLOPTS|$BASHOPTS"
bash -o pipefail -c 'echo "$SHELLOPTS|$BASHOPTS"; false | true; echo "rc=$?"'
`, { onState() {} });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "braceexpand:hashall|globskipdots:patsub_replacement:sourcepath\nbraceexpand:hashall:pipefail|globskipdots:nullglob:patsub_replacement:sourcepath\nbraceexpand:hashall|globskipdots:patsub_replacement:sourcepath\nbraceexpand:hashall:pipefail|globskipdots:nullglob:patsub_replacement:sourcepath\nbraceexpand:hashall:pipefail|globskipdots:patsub_replacement:sourcepath\nrc=1\n");
    const restored = await shell.exec('echo "$SHELLOPTS|$BASHOPTS"', { state: result.state });
    assert.equal(restored.stdout, "braceexpand:hashall:pipefail|globskipdots:nullglob:patsub_replacement:sourcepath\n");
  } finally { await shell.dispose(); }
});

test("option variables are readonly and ignore environment startup options", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    for (const name of ["SHELLOPTS", "BASHOPTS"]) {
      for (const source of [`${name}=bogus; echo changed`, `unset ${name}`, `declare ${name}=bogus`]) {
        const result = await shell.exec(source);
        assert.notEqual(result.exitCode, 0, source);
        assert.match(result.stderr, /readonly/);
        assert.equal(result.stdout, "");
      }
    }
    const result = await shell.exec(`echo "$SHELLOPTS|$BASHOPTS"
export SHELLOPTS BASHOPTS
set -o pipefail
shopt -s nullglob
bash -c 'echo "$SHELLOPTS|$BASHOPTS"'`, { env: { SHELLOPTS: "pipefail", BASHOPTS: "nullglob" } });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "braceexpand:hashall|globskipdots:patsub_replacement:sourcepath\nbraceexpand:hashall|globskipdots:patsub_replacement:sourcepath\n");
  } finally { await shell.dispose(); }
});

test("option variables include every enabled supported and extension option in sorted order", async () => {
  const { shell } = setup({ extensions: [{ name: "options", create: () => ({
    builtins: [],
    options: [{ name: "zeta", enabled: true }],
    shoptOptions: [{ name: "alpha", enabled: true }],
  }) }] });
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`set -aefuC
set -o pipefail
shopt -s checkhash dotglob expand_aliases extglob failglob globstar inherit_errexit lastpipe nocaseglob nocasematch nullglob varredir_close xpg_echo
echo "$SHELLOPTS|$BASHOPTS"
set +o zeta
shopt -u alpha
set +B
shopt -u globskipdots
echo "$SHELLOPTS|$BASHOPTS"`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "allexport:braceexpand:errexit:hashall:noclobber:noglob:nounset:pipefail:zeta|alpha:checkhash:dotglob:expand_aliases:extglob:failglob:globskipdots:globstar:inherit_errexit:lastpipe:nocaseglob:nocasematch:nullglob:patsub_replacement:sourcepath:varredir_close:xpg_echo\nallexport:errexit:hashall:noclobber:noglob:nounset:pipefail|checkhash:dotglob:expand_aliases:extglob:failglob:globstar:inherit_errexit:lastpipe:nocaseglob:nocasematch:nullglob:patsub_replacement:sourcepath:varredir_close:xpg_echo\n");
    const noexec = await shell.exec("set -n", { onState() {} });
    assert.equal(noexec.state?.variables.SHELLOPTS, "braceexpand:hashall:noexec:zeta");
  } finally { await shell.dispose(); }
});

test("xpg_echo survives session snapshots and respects explicit echo flags", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const enabled = await shell.exec("shopt -s xpg_echo", { onState() {} });
    assert.equal(enabled.exitCode, 0, enabled.stderr);
    assert.equal(enabled.state?.options?.xpg_echo, true);
    const restored = await shell.exec('echo "a\\\\nb"; echo -E "a\\\\nb"', { state: enabled.state });
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, "a\nb\na\\nb\n");
  } finally { await shell.dispose(); }
});

test("lastpipe retains read and mapfile changes only when enabled", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`printf 'old\\n' | read value
printf '<%s>\\n' "$value"
shopt -s lastpipe
printf 'new\\n' | read value
printf 'a\\nb\\n' | mapfile -t arr
printf '<%s>\\n' "$value" "${'${arr[@]}'}"`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "<>\n<new>\n<a>\n<b>\n");
  } finally { await shell.dispose(); }
});

test("failglob aborts unmatched expansion, including with nullglob", async () => {
  for (const options of ["failglob", "failglob nullglob", "failglob globstar"]) {
    const { shell } = setup();
    shell.use(standardCommands());
    try {
      const result = await shell.exec(`shopt -s ${options}\necho /missing_*/**`);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /no match/);
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  }
});

test("inherit_errexit controls command substitution failure", async () => {
  for (const enabled of [false, true]) {
    const { shell } = setup();
    shell.use(standardCommands());
    try {
      const result = await shell.exec(`set -e\nshopt -${enabled ? "s" : "u"} inherit_errexit\nx=$(false; echo after)\necho "$x"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, enabled ? 1 : 0);
      assert.equal(result.stdout, enabled ? "" : "after\n");
    } finally { await shell.dispose(); }
  }
});

test("aliases expand at read time with quoting, recursion and removal", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`shopt -s expand_aliases
alias hi='echo hello'
hi world
alias echo='echo prefixed'
echo value
unalias echo
alias hi
unalias -a
alias -p`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "hello world\nprefixed value\nalias hi='echo hello'\n");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("process substitution keeps scratch paths out of root and cleans up", async () => {
  const { shell, fs } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec("args <(echo value)");
    assert.equal(result.stderr, "");
    const [path] = JSON.parse(result.stdout) as string[];
    assert.ok(path?.startsWith("/dev/fd/") || path?.startsWith("/tmp/"), path);
    assert.deepEqual(await fs.readdir("/tmp"), []);
    assert.ok((await fs.readdir("/")).every(entry => !entry.name.startsWith(".procsub-")));
  } finally { await shell.dispose(); }
});

for (const [source, stdout] of [
  ["alias a=b b='echo ok'\na", "ok\n"],
  ["alias a='echo ' b=expanded\na b", "expanded\n"],
  ["alias a='if true; then' z=fi\na echo yes; z", "yes\n"],
  ["alias hi='echo hello'\neval hi", "hello\n"],
  ["alias hi='echo hello'\necho $(hi)", "hello\n"],
  ["alias hi='echo hello'\nf() { hi; }\nunalias hi\nf", "hello\n"],
  ["alias hi='echo hello'\n'hi' 2>/dev/null\necho $?", "127\n"],
  ["alias hi='echo hello'; hi 2>/dev/null\necho $?", "127\n"],
  ["alias a='echo one; echo two'\na", "one\ntwo\n"],
  ["alias hi='echo hello'\n(unalias hi)\nhi", "hello\n"],
] as const) test(`alias parser: ${source}`, async () => {
  const { shell } = setup({ limits: { maxCommands: 100, maxParseUnits: 100000 } });
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`shopt -s expand_aliases\n${source}`);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("sessions retain aliases and options, including sourced scripts", async () => {
  const { shell, fs } = setup();
  shell.use(standardCommands());
  try {
    await fs.writeFile("/script", new TextEncoder().encode("hi\n"));
    const session = shell.createSession();
    assert.equal((await session.exec("shopt -s expand_aliases lastpipe failglob inherit_errexit\nalias hi='echo hello'")).exitCode, 0);
    for (const source of ["hi", "eval hi", "source /script", ". /script"]) {
      const result = await session.exec(source);
      assert.equal(result.stdout, "hello\n", source);
      assert.equal(result.stderr, "", source);
    }
    assert.equal((await session.exec("shopt -q expand_aliases lastpipe failglob inherit_errexit")).exitCode, 0);
    assert.equal((await session.exec("alias condition='if true'")).exitCode, 0);
    const conditional = await session.exec("condition; then echo yes; fi");
    assert.equal(conditional.stdout, "yes\n");
    assert.equal(conditional.stderr, "");
  } finally { await shell.dispose(); }
});

test("lastpipe preserves EXIT timing and final status", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec("shopt -s lastpipe\ntrap 'echo EXIT' EXIT\necho hi | read v\necho $v");
    assert.equal(result.stdout, "hi\nEXIT\n");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("failglob skips its parsed line and respects errexit", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    for (const enabled of [false, true]) {
      const result = await shell.exec(`${enabled ? "set -e\n" : ""}shopt -s failglob\nif echo /missing_*; then echo yes; fi\necho after`);
      assert.equal(result.stdout, enabled ? "" : "after\n");
      assert.equal(result.exitCode, enabled ? 1 : 0);
      assert.match(result.stderr, /no match/);
    }
  } finally { await shell.dispose(); }
});

test("process substitutions use writable tmp with a read-only root and preserve collisions", async () => {
  const root = new MemoryFileSystem();
  const tmp = new MemoryFileSystem();
  await tmp.writeFile("/.procsub-1", new TextEncoder().encode("existing"));
  const fs = new MountFileSystem({ root: new ReadOnlyFileSystem(root), mounts: { "/tmp": tmp } });
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("cat <(echo input); echo output > >(cat)");
    assert.equal(result.stdout, "input\noutput\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await tmp.readFile("/.procsub-1")), "existing");
    assert.equal((await tmp.readdir("/")).length, 1);
    assert.deepEqual(await root.readdir("/"), []);
  } finally { await shell.dispose(); }
});
