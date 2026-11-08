import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { agentCommands } from "../../src/index.js";

test("supports zsh parameter expansion flags (f) and (tP) plus print/functions/setopt/alias -L/typeset +x", async () => {
  const { shell } = setup();
  await shell.use(agentCommands({ replace: true }));
  const script = `export FOO="bar baz"
if [[ -n "\${ZDOTDIR-}" ]]; then
  rc="$ZDOTDIR/.zshrc"
else
  rc="$HOME/.zshrc"
fi
[[ -r "$rc" ]] && . "$rc"
print "# Functions"
functions
print ""
setopt_count=$(setopt | wc -l | tr -d "[:space:]")
print "# setopt ($setopt_count)"
setopt | sed "s/^/setopt /"
print ""
unsetopt_count=$(unsetopt | wc -l | tr -d "[:space:]")
print "# unsetopt ($unsetopt_count)"
unsetopt | sed "s/^/unsetopt /"
print ""
alias_count=$(alias -L | wc -l | tr -d "[:space:]")
print "# aliases ($alias_count)"
alias -L
print ""
print "#SNAPSHOT_MARKER"
for __codex_snapshot_export_name in \${(f)"$(typeset +x)"}; do
  case "\${(tP)__codex_snapshot_export_name}" in
    *hideval*|*special*) continue ;;
  esac
  typeset -p -- "$__codex_snapshot_export_name" 2>/dev/null || true
done`;

  try {
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /# Functions/);
    assert.match(result.stdout, /#SNAPSHOT_MARKER/);
    assert.match(result.stdout, /declare -x FOO="bar baz"/);
  } finally {
    await shell.dispose();
  }
});

test("supports zsh virtual interpreter invocation via exec '/tmp/zsh' -c and '/bin/zsh' -c", async () => {
  const { shell } = setup();
  await shell.use(agentCommands({ replace: true }));
  try {
    const res1 = await shell.exec("export SNAP='hello'; exec '/tmp/zsh' -c 'printf \"%s\\n\" \"$SNAP\"'");
    assert.equal(res1.exitCode, 0);
    assert.equal(res1.stderr, "");
    assert.equal(res1.stdout, "hello\n");

    const res2 = await shell.exec("/bin/zsh -lc 'printf ok'");
    assert.equal(res2.exitCode, 0);
    assert.equal(res2.stderr, "");
    assert.equal(res2.stdout, "ok");
  } finally {
    await shell.dispose();
  }
});
