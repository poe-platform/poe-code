import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import type { ShellSessionState } from "../../src/index.js";

test("default shell.exec remains stateless when no session hooks or state are supplied", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await shell.exec("cd /work && FOO=local && export BAR=exported && umask 0077");
    const next = await shell.exec("pwd; printf '<%s><%s>\\n' \"$FOO\" \"$BAR\"; umask");
    assert.equal(next.exitCode, 0);
    assert.equal(next.stdout, "/\n<><>\n0022\n");
  } finally {
    await shell.dispose();
  }
});

test("per-call state and onState hooks preserve cwd, env, scalars, attributes, arrays, functions, umask, directory stack, and options", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/work/a");
  await fs.mkdir("/work/b");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    let saved: ShellSessionState | undefined;
    const step1 = await shell.exec(
      `
      cd /work/a
      pushd /work/b >/dev/null
      umask 0077
      SCALAR="hello world"
      export EXPORTED_VAR="visible_in_child"
      declare -i COUNTER=10
      declare -u SHOUT="quiet"
      readonly PINNED="immutable"
      arr=(alpha "beta gamma" [4]=delta)
      declare -A assoc=([first]="one" [second]="two words")
      my_func() {
        printf 'func:%s:%s\\n' "$1" "$SCALAR"
      }
      export -f my_func
      shopt -s dotglob nullglob
      set -o pipefail
      `,
      {
        onState(state) {
          saved = state;
        },
      },
    );
    assert.equal(step1.exitCode, 0, step1.stderr);
    assert.ok(saved, "Expected onState hook to receive ShellSessionState");
    assert.equal(step1.state?.cwd, "/work/b");

    const step2 = await shell.exec(
      `
      pwd
      umask
      COUNTER+=5
      SHOUT="loud"
      printf 'scalar=%s exported=%s counter=%s shout=%s pinned=%s\\n' "$SCALAR" "$EXPORTED_VAR" "$COUNTER" "$SHOUT" "$PINNED"
      printf 'arr=%s|%s|%s len=%s\\n' "\${arr[0]}" "\${arr[1]}" "\${arr[4]}" "\${#arr[@]}"
      printf 'assoc=%s|%s\\n' "\${assoc[first]}" "\${assoc[second]}"
      my_func arg1
      bash -c 'my_func from_child; printf "child_env=%s\\n" "$EXPORTED_VAR"'
      popd >/dev/null
      pwd
      shopt -q dotglob && shopt -q nullglob && printf 'shopt=ok\\n'
      set -o | grep -E '^pipefail[[:space:]]+on$' >/dev/null && printf 'pipefail=ok\\n'
      `,
      {
        state: saved,
        onState(state) {
          saved = state;
        },
      },
    );
    assert.equal(step2.exitCode, 0, step2.stderr);
    assert.equal(
      step2.stdout,
      [
        "/work/b",
        "0077",
        "scalar=hello world exported=visible_in_child counter=15 shout=LOUD pinned=immutable",
        "arr=alpha|beta gamma|delta len=3",
        "assoc=one|two words",
        "func:arg1:hello world",
        "func:from_child:",
        "child_env=visible_in_child",
        "/work/a",
        "shopt=ok",
        "pipefail=ok",
        "",
      ].join("\n"),
    );

    const readonlyCheck = await shell.exec("PINNED=changed", { state: saved });
    assert.notEqual(readonlyCheck.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

test("ShellSessionState is JSON-serializable and restorable on a fresh Shell instance", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/project");
  const shell1 = new Shell({ fs }).use(agentCommands());
  let serialized = "";
  try {
    await shell1.exec(
      `
      cd /project
      export API_KEY="secret-123"
      declare -i RETRIES=3
      items=(one two three)
      declare -A meta=([env]=prod [region]=us-east)
      helper() { printf 'helper:%s:%s\\n' "$1" "$API_KEY"; }
      `,
      {
        onState(state) {
          serialized = JSON.stringify(state);
        },
      },
    );
  } finally {
    await shell1.dispose();
  }

  const restoredState = JSON.parse(serialized) as ShellSessionState;
  const shell2 = new Shell({ fs }).use(agentCommands());
  try {
    const res = await shell2.exec(
      `
      RETRIES+=2
      printf 'cwd=%s retries=%s items=%s region=%s\\n' "$(pwd)" "$RETRIES" "\${items[1]}" "\${meta[region]}"
      helper ok
      `,
      { state: restoredState },
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "cwd=/project retries=5 items=two region=us-east\nhelper:ok:secret-123\n");
  } finally {
    await shell2.dispose();
  }
});

test("Shell-level hooks (beforeExec / afterExec) and shell.createSession() chain state across turns", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/workspace");
  await fs.mkdir("/workspace/pkg");
  let hookState: ShellSessionState | undefined;
  const shell = new Shell({
    fs,
    hooks: {
      beforeExec: () => hookState,
      afterExec: state => {
        hookState = state;
      },
    },
  }).use(agentCommands());

  try {
    await shell.exec("cd /workspace && export STEP=1");
    await shell.exec("cd pkg && STEP=2");
    const check = await shell.exec("printf '%s:%s\\n' \"$(pwd)\" \"$STEP\"");
    assert.equal(check.stdout, "/workspace/pkg:2\n");

    const overrideCheck = await shell.exec("printf '%s:%s\\n' \"$(pwd)\" \"$STEP\"", {
      cwd: "/workspace",
      env: { STEP: "override" },
    });
    assert.equal(overrideCheck.stdout, "/workspace:override\n");

    const session = shell.createSession();
    await session.exec("cd /workspace && SESSION_ONLY=yes");
    const sRes = await session.exec("printf '%s:%s\\n' \"$(pwd)\" \"$SESSION_ONLY\"");
    assert.equal(sRes.stdout, "/workspace:yes\n");
  } finally {
    await shell.dispose();
  }
});
