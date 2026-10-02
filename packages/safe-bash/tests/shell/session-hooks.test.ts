import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import type { ShellSessionState } from "../../src/index.js";

test("sessions preserve aliases and positional parameters, including empty and quoted arguments", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const session = shell.createSession();
    await session.exec('shopt -s expand_aliases; alias greet="echo hello_from_alias"; set -- alpha "beta gamma" ""');
    assert.equal((await session.exec('greet; printf "count=%s\\n" "$#"; printf "<%s>\\n" "$@"')).stdout,
      "hello_from_alias\ncount=3\n<alpha>\n<beta gamma>\n<>\n");
    await session.exec("shift; unalias greet");
    assert.equal((await session.exec('printf "<%s>\\n" "$@"')).stdout, "<beta gamma>\n<>\n");
    await session.exec("set --");
    assert.equal((await session.exec('echo "$#"')).stdout, "0\n");
  } finally { await shell.dispose(); }
});

test("session background jobs survive turns without blocking foreground completion", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  shell.register({ name: "hold", async execute() { await gate; return { exitCode: 7 }; } });
  try {
    const session = shell.createSession();
    const launch = session.exec("hold &");
    const result = await Promise.race([launch, new Promise<undefined>(resolve => setImmediate(() => resolve(undefined)))]);
    assert.ok(result, "background work must not hold the session turn open");
    const listed = await session.exec('jobs; jobs -l; echo "$!"');
    assert.equal(listed.stdout, "[1]+  Running                 hold &\n[1]+ 1001 Running                 hold &\n1001\n");
    release();
    assert.equal((await session.exec('wait "$!"')).exitCode, 7);
    assert.equal((await session.exec("jobs")).stdout, "");
  } finally { release(); await shell.dispose(); }
});

test("disown and disown -h preserve distinct wait behavior across session turns", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  shell.register({ name: "hold", async execute() { await gate; return { exitCode: 7 }; } });
  try {
    const session = shell.createSession();
    await session.exec("hold &");
    const detached = await session.exec('pid=$!; disown; jobs; wait; echo done; wait "$pid"');
    assert.equal(detached.stdout, "done\n");
    assert.equal(detached.exitCode, 127);
    assert.equal((await session.exec("wait %1")).exitCode, 127);
    await session.exec("hold & disown -h");
    assert.equal((await session.exec('jobs -p; echo "$!"')).stdout, "1002\n1002\n");
    const waiting = session.exec('wait "$!"');
    assert.equal(await Promise.race([waiting.then(() => "settled"), new Promise<string>(resolve => setImmediate(() => resolve("pending")))]), "pending");
    release();
    assert.equal((await waiting).exitCode, 7);
    await session.dispose();
  } finally { release(); await shell.dispose(); }
});

for (const target of ["%1", "$!"]) {
  test(`disown -r keeps completed explicit target ${target}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
    try {
      const session = shell.createSession();
      await session.exec("true &");
      // All children have completed before the next event-loop turn.
      await new Promise<void>(resolve => setImmediate(resolve));
      const result = await session.exec(`disown -r ${target}; jobs; jobs -p; wait`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "[1]+  Done                    true\n1001\n");
    } finally { await shell.dispose(); }
  });
}

test("session disposal cancels and cleans up active children, including disowned jobs", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
  let cleaned = 0;
  shell.register({ name: "hold", async execute(context) {
    context.registerCleanup?.(() => { cleaned++; });
    await new Promise<void>(resolve => {
      if (context.signal.aborted) resolve();
      else context.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    return { exitCode: 0 };
  } });
  try {
    const session = shell.createSession();
    await session.exec("hold & disown; hold & disown -h");
    await session.dispose();
    assert.equal(cleaned, 2);
    await assert.rejects(session.exec("true"), /session is disposed/);
    assert.equal((await shell.exec("echo usable")).stdout, "usable\n");
  } finally { await shell.dispose(); }
});

test("session job tables are isolated and concurrent turns retain submission order", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
  try {
    const first = shell.createSession();
    const second = shell.createSession();
    await first.exec("true &");
    assert.equal((await second.exec('jobs; echo "$!"')).stdout, "\n");
    const [, result] = await Promise.all([first.exec("set -- one two"), first.exec('echo "$#:$1:$2"')]);
    assert.equal(result.stdout, "2:one:two\n");
    await first.dispose();
    await second.dispose();
  } finally { await shell.dispose(); }
});

test("background execution retains its runtime and output sinks after a session turn returns", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, backgroundJobs: true }).use(agentCommands());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  shell.register({ name: "hold", async execute() { await gate; return { exitCode: 0 }; } });
  const output: Uint8Array[] = [];
  try {
    const session = shell.createSession();
    await session.exec('{ hold; printf late > /result; cat /result; } &', {
      stdout: { async write(chunk) { output.push(chunk.slice()); } },
    });
    release();
    assert.equal((await session.exec("wait")).exitCode, 0);
    assert.equal((await session.exec("cat /result")).stdout, "late");
    assert.equal(new TextDecoder().decode(Buffer.concat(output)), "late");
    await session.dispose();
  } finally { release(); await shell.dispose(); }
});

test("a launch turn's cancellation still reaches its child after foreground completion", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
  const controller = new AbortController();
  const reason = new Error("cancel background owner");
  let cleaned = 0;
  shell.register({ name: "hold", async execute(context) {
    context.registerCleanup?.(() => { cleaned++; });
    await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), { once: true }));
    return { exitCode: 0 };
  } });
  try {
    const session = shell.createSession();
    await session.exec("hold &", { signal: controller.signal });
    controller.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(cleaned, 1);
    await assert.rejects(session.exec("jobs"), error => error === reason);
    await session.dispose();
  } finally { await shell.dispose(); }
});

test("shell disposal reports a background cleanup failure after its turn has returned", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), backgroundJobs: true }).use(agentCommands());
  let disposed = false;
  shell.use({ name: "disposal-observer", setup() {}, dispose() { disposed = true; } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const failure = new Error("background cleanup failed");
  shell.register({ name: "hold", async execute(context) {
    context.registerCleanup?.(() => { throw failure; });
    await gate;
    return { exitCode: 0 };
  } });
  await shell.createSession().exec("hold &");
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(shell.dispose(), error => error === failure);
  assert.equal(disposed, true);
});

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
