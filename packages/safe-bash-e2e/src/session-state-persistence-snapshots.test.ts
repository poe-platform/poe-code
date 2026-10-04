import assert from "node:assert/strict";
import test from "node:test";
import { SafeBashE2EHarness, sb, withE2EHarness } from "./harness.js";

test("session preserves cwd, OLDPWD, cd -, and umask across multiple turns", async () => {
  await withE2EHarness(
    { directories: ["/workspace/proj/src", "/workspace/proj/dist"] },
    async (h) => {
      const session = h.shell.createSession();

      const t1 = await session.exec("umask 0027 && cd /workspace/proj/src && pwd");
      assert.equal(t1.exitCode, 0, t1.stderr);
      assert.equal(t1.stdout, "/workspace/proj/src\n");

      const t2 = await session.exec("cd ../dist && pwd && umask");
      assert.equal(t2.exitCode, 0, t2.stderr);
      assert.equal(t2.stdout, "/workspace/proj/dist\n0027\n");

      const t3 = await session.exec("cd - >/dev/null && pwd && touch created.txt && stat -c '%a' created.txt");
      assert.equal(t3.exitCode, 0, t3.stderr);
      assert.equal(t3.stdout, "/workspace/proj/src\n640\n");
    },
  );
});

test("session preserves scalar variables, exported environment variables, and unset across turns", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    await session.exec("LOCAL_TOKEN='secret-123'; export API_HOST='api.acme.internal' DEPRECATED='old'");
    await session.exec("unset DEPRECATED; LOCAL_TOKEN=\"${LOCAL_TOKEN}-v2\"");

    const t3 = await session.exec(
      "printf 'local=%s env=%s dep=%s\\n' \"$LOCAL_TOKEN\" \"$(printenv API_HOST)\" \"${DEPRECATED:-missing}\"",
    );
    assert.equal(t3.exitCode, 0, t3.stderr);
    assert.equal(t3.stdout, "local=secret-123-v2 env=api.acme.internal dep=missing\n");
  });
});

test("session enforces readonly variables across subsequent turns and JSON round-trips", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec("readonly IMMUTABLE_KEY='locked-v1'");
    assert.equal(t1.exitCode, 0, t1.stderr);

    session.state = JSON.parse(JSON.stringify(session.state));

    const t2 = await session.exec("IMMUTABLE_KEY='tampered'");
    assert.notEqual(t2.exitCode, 0);

    const t3 = await session.exec("unset IMMUTABLE_KEY");
    assert.notEqual(t3.exitCode, 0);

    const t4 = await session.exec("printf '%s\\n' \"$IMMUTABLE_KEY\"");
    assert.equal(t4.exitCode, 0);
    assert.equal(t4.stdout, "locked-v1\n");
  });
});

test("session preserves declare -i (integer), -l (lowercase), and -u (uppercase) attributes across turns", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec("declare -i counter=10; declare -l lower='HeLLo'; declare -u upper='woRLd'");
    assert.equal(t1.exitCode, 0, t1.stderr);

    session.state = JSON.parse(JSON.stringify(session.state));

    const t2 = await session.exec("counter='counter + 5 * 3'; lower='MiXeD_CaSe'; upper='rust_core'");
    assert.equal(t2.exitCode, 0, t2.stderr);

    const t3 = await session.exec("printf '%d|%s|%s\\n' \"$counter\" \"$lower\" \"$upper\"");
    assert.equal(t3.exitCode, 0, t3.stderr);
    assert.equal(t3.stdout, "25|mixed_case|RUST_CORE\n");
  });
});

test("session preserves dense and sparse indexed arrays across turns and JSON serialization", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    await session.exec("arr=('alpha' 'beta' 'gamma'); arr[10]='omega'");
    session.state = JSON.parse(JSON.stringify(session.state));

    await session.exec("unset 'arr[1]'; arr+=('delta')");

    const res = await session.exec(
      "printf 'count=%d keys=%s vals=%s\\n' \"${#arr[@]}\" \"${!arr[*]}\" \"${arr[*]}\"",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "count=4 keys=0 2 10 11 vals=alpha gamma omega delta\n");
  });
});

test("session preserves associative arrays (declare -A) across turns and JSON serialization", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec(
      "declare -A cfg=([host]='db.internal' [port]='5432' [mode]='rw')",
    );
    assert.equal(t1.exitCode, 0, t1.stderr);

    session.state = JSON.parse(JSON.stringify(session.state));

    const t2 = await session.exec("cfg[port]='6432'; unset 'cfg[mode]'; cfg[tls]='required'");
    assert.equal(t2.exitCode, 0, t2.stderr);

    const t3 = await session.exec(
      "printf '%s:%s:%s:%d\\n' \"${cfg[host]}\" \"${cfg[port]}\" \"${cfg[tls]}\" \"${#cfg[@]}\"",
    );
    assert.equal(t3.exitCode, 0, t3.stderr);
    assert.equal(t3.stdout, "db.internal:6432:required:3\n");
  });
});

test("session preserves shell functions across in-memory turns and cold JSON deserialization", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec([
      "double() { echo $(( $1 * 2 )); }",
      "quad() { local d=$(double \"$1\"); double \"$d\"; }",
    ].join("\n"));
    assert.equal(t1.exitCode, 0, t1.stderr);

    const t2 = await session.exec("quad 7");
    assert.equal(t2.exitCode, 0, t2.stderr);
    assert.equal(t2.stdout, "28\n");

    // Force cold AST re-parsing by stripping WeakMap identity via JSON round-trip
    session.state = JSON.parse(JSON.stringify(session.state));

    const t3 = await session.exec("quad 11");
    assert.equal(t3.exitCode, 0, t3.stderr);
    assert.equal(t3.stdout, "44\n");
  });
});

test("session preserves readonly -f functions across turns and prevents redefinition or unset", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec("guard_fn() { echo 'v1'; }; readonly -f guard_fn");
    assert.equal(t1.exitCode, 0, t1.stderr);

    session.state = JSON.parse(JSON.stringify(session.state));

    const t2 = await session.exec("guard_fn() { echo 'v2'; }");
    assert.notEqual(t2.exitCode, 0);

    const t3 = await session.exec("unset -f guard_fn");
    assert.notEqual(t3.exitCode, 0);

    const t4 = await session.exec("guard_fn");
    assert.equal(t4.exitCode, 0);
    assert.equal(t4.stdout, "v1\n");
  });
});

test("session preserves directory stack (pushd / popd / dirs) across turns and JSON serialization", async () => {
  await withE2EHarness(
    { directories: ["/workspace/a", "/workspace/b", "/workspace/c"] },
    async (h) => {
      const session = h.shell.createSession();

      await session.exec("cd /workspace/a && pushd /workspace/b >/dev/null && pushd /workspace/c >/dev/null");
      session.state = JSON.parse(JSON.stringify(session.state));

      const t2 = await session.exec("dirs -p | paste -sd ',' -");
      assert.equal(t2.exitCode, 0, t2.stderr);
      assert.equal(t2.stdout, "/workspace/c,/workspace/b,/workspace/a\n");

      const t3 = await session.exec("popd >/dev/null && pwd && popd >/dev/null && pwd");
      assert.equal(t3.exitCode, 0, t3.stderr);
      assert.equal(t3.stdout, "/workspace/b\n/workspace/a\n");
    },
  );
});

test("session preserves POSIX set options (-e, -u, -o pipefail, -C, -f) across turns", async () => {
  await withE2EHarness(
    { files: { "/workspace/existing.txt": "keep\n" } },
    async (h) => {
      const session = h.shell.createSession();

      const t1 = await session.exec("set -euo pipefail -C -f");
      assert.equal(t1.exitCode, 0, t1.stderr);

      session.state = JSON.parse(JSON.stringify(session.state));

      // -u (nounset) rejects unset variable expansion
      const t2 = await session.exec("echo \"$DEFINITELY_UNSET_VAR\"");
      assert.notEqual(t2.exitCode, 0);

      // -C (noclobber) rejects overwriting existing file
      const t3 = await session.exec("echo 'overwrite' > /workspace/existing.txt");
      assert.notEqual(t3.exitCode, 0);

      // -f (noglob) keeps literal '*'
      const t4 = await session.exec("printf '%s\\n' *.txt");
      assert.equal(t4.exitCode, 0, t4.stderr);
      assert.equal(t4.stdout, "*.txt\n");

      // -o pipefail fails pipeline when left command fails
      const t5 = await session.exec("false | true");
      assert.notEqual(t5.exitCode, 0);
    },
  );
});

test("session preserves shopt options (dotglob, globstar, nullglob, nocaseglob, extglob) across turns", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/.hidden": "1",
        "/workspace/Readme.MD": "2",
        "/workspace/sub/deep/app.ts": "3",
      },
    },
    async (h) => {
      const session = h.shell.createSession();

      const t1 = await session.exec("shopt -s dotglob globstar nullglob nocaseglob extglob");
      assert.equal(t1.exitCode, 0, t1.stderr);

      session.state = JSON.parse(JSON.stringify(session.state));

      const t2 = await session.exec([
        "printf 'null:%s\\n' *.nonexistent",
        "printf 'nocase:%s\\n' readme*",
        "printf 'deep:%s\\n' **/app.ts",
      ].join("\n"));
      assert.equal(t2.exitCode, 0, t2.stderr);
      assert.equal(
        t2.stdout,
        [
          "null:",
          "nocase:Readme.MD",
          "deep:sub/deep/app.ts",
          "",
        ].join("\n"),
      );
    },
  );
});

test("session branching and time-travel checkpoint restore isolates speculative mutations", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    await session.exec("STAGE='baseline'; declare -a ITEMS=('one' 'two'); helper() { echo \"[$STAGE:${ITEMS[*]}]\"; }");
    const checkpoint = JSON.parse(JSON.stringify(session.state));

    // Branch A: mutate variables, array, and function
    await session.exec("STAGE='branch-a'; ITEMS=('mutated'); helper() { echo 'corrupted'; }");
    const branchARes = await session.exec("helper");
    assert.equal(branchARes.stdout, "corrupted\n");

    // Rewind to checkpoint and run Branch B
    session.state = checkpoint;
    await session.exec("ITEMS+=('three')");
    const branchBRes = await session.exec("helper");
    assert.equal(branchBRes.exitCode, 0, branchBRes.stderr);
    assert.equal(branchBRes.stdout, "[baseline:one two three]\n");
  });
});

test("ShellSessionHooks beforeExec and afterExec and onState track state transitions", async () => {
  await withE2EHarness(async (h) => {
    const transitions: Array<{ cmd: string; cwd: string; status: number | undefined }> = [];

    const session = h.shell.createSession();
    for (const cmd of ["mkdir -p /workspace/step1 && cd /workspace/step1", "VAR=42", "(exit 7)"]) {
      await session.exec(cmd, {
        hooks: {
          afterExec: (state) => {
            transitions.push({ cmd, cwd: state.cwd, status: state.status });
          },
        },
      });
    }

    assert.equal(transitions.length, 3);
    assert.equal(transitions[0]!.cwd, "/workspace/step1");
    assert.equal(transitions[0]!.status, 0);
    assert.equal(transitions[1]!.cwd, "/workspace/step1");
    assert.equal(transitions[1]!.status, 0);
    assert.equal(transitions[2]!.status, 7);
  });
});

test("per-call cwd and env overrides on session.exec merge cleanly with restored session state", async () => {
  await withE2EHarness({ directories: ["/workspace/override-dir"] }, async (h) => {
    const session = h.shell.createSession();
    await session.exec("SAVED='from-turn-1'; export SHARED='turn1'");

    const t2 = await session.exec(
      "printf '%s|%s|%s|%s\\n' \"$(pwd)\" \"$SAVED\" \"$SHARED\" \"$INJECTED\"",
      {
        cwd: "/workspace/override-dir",
        env: { SHARED: "overridden", INJECTED: "ephemeral" },
      },
    );
    assert.equal(t2.exitCode, 0, t2.stderr);
    assert.equal(t2.stdout, "/workspace/override-dir|from-turn-1|overridden|ephemeral\n");
  });
});

test("subshell execution inside a session turn does not leak mutations to subsequent turns", async () => {
  await withE2EHarness({ directories: ["/workspace/sub"] }, async (h) => {
    const session = h.shell.createSession();
    await session.exec("COUNT=1; umask 0022; cd /workspace");

    const t2 = await session.exec("(cd /workspace/sub; COUNT=999; umask 0077; set -u; echo \"sub:$COUNT:$(pwd)\")");
    assert.equal(t2.exitCode, 0, t2.stderr);
    assert.equal(t2.stdout, "sub:999:/workspace/sub\n");

    const t3 = await session.exec("printf 'parent:%s:%s:%s:%s\\n' \"$COUNT\" \"$(pwd)\" \"$(umask)\" \"${UNSET_OK:-ok}\"");
    assert.equal(t3.exitCode, 0, t3.stderr);
    assert.equal(t3.stdout, "parent:1:/workspace:0022:ok\n");
  });
});

test("session preserves last exit status ($?) across turns when inspected immediately", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec("(exit 42)");
    assert.equal(t1.exitCode, 42);
    assert.equal(session.state?.status, 42);

    const t2 = await session.exec("printf 'prev_status=%d\\n' \"$?\"");
    assert.equal(t2.exitCode, 0);
    assert.equal(t2.stdout, "prev_status=42\n");
  });
});

test("transactional agent checkpoint: coordinated ShellSessionState + OverlayFileSystem rollback", async () => {
  const lowerFs = new sb.MemoryFileSystem();
  await lowerFs.mkdir("/workspace", { recursive: true });
  await lowerFs.writeFile(
    "/workspace/schema.sql",
    new TextEncoder().encode("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO items VALUES (1, 'stable');\n"),
  );

  const upperFs = new sb.MemoryFileSystem();
  const overlay = sb.createOverlayFileSystem({ lower: lowerFs, upper: upperFs });
  const h = await SafeBashE2EHarness.create({ fs: overlay });
  try {
    const session = h.shell.createSession();

    // Turn 1: Initialize database and session state
    const t1 = await session.exec([
      "DB_PATH='/workspace/app.db'",
      "MIGRATION_VERSION=1",
      "query_items() { sqlite3 \"$DB_PATH\" 'SELECT id, name FROM items ORDER BY id;'; }",
      "sqlite3 \"$DB_PATH\" < /workspace/schema.sql",
      "query_items",
    ].join("\n"));
    assert.equal(t1.exitCode, 0, t1.stderr);
    assert.equal(t1.stdout, "1|stable\n");

    // Save session checkpoint and snapshot upper filesystem bytes
    const savedSessionState = JSON.parse(JSON.stringify(session.state));
    const savedDbBytes = await upperFs.readFile("/workspace/app.db");

    // Turn 2: Run faulty migration that corrupts state and DB
    await session.exec([
      "MIGRATION_VERSION=2",
      "sqlite3 \"$DB_PATH\" \"DELETE FROM items; INSERT INTO items VALUES (99, 'corrupted');\"",
    ].join("\n"));
    const corrupted = await session.exec("printf 'v=%s rows=%s\\n' \"$MIGRATION_VERSION\" \"$(query_items)\"");
    assert.equal(corrupted.stdout, "v=2 rows=99|corrupted\n");

    // Rollback both session state and upper filesystem
    session.state = savedSessionState;
    await upperFs.writeFile("/workspace/app.db", savedDbBytes);

    const restored = await session.exec("printf 'v=%s rows=%s\\n' \"$MIGRATION_VERSION\" \"$(query_items)\"");
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, "v=1 rows=1|stable\n");
  } finally {
    await h.dispose();
  }
});

test("cold-restoring JSON-serialized ShellSessionState into a brand-new Shell instance", async () => {
  const sharedFs = new sb.MemoryFileSystem();
  await sharedFs.mkdir("/workspace/app", { recursive: true });

  const h1 = await SafeBashE2EHarness.create({ fs: sharedFs });
  let serializedState = "";
  try {
    const s1 = h1.shell.createSession();
    await s1.exec([
      "cd /workspace/app",
      "export APP_ENV='staging'",
      "declare -A ROUTES=([health]='/healthz' [metrics]='/metrics')",
      "route_for() { printf '%s\\n' \"${ROUTES[$1]:-/404}\"; }",
    ].join("\n"));
    serializedState = JSON.stringify(s1.state);
  } finally {
    await h1.dispose();
  }

  const h2 = await SafeBashE2EHarness.create({ fs: sharedFs });
  try {
    const s2 = h2.shell.createSession(JSON.parse(serializedState));
    const res = await s2.exec(
      "printf '%s|%s|%s|%s\\n' \"$(pwd)\" \"$(printenv APP_ENV)\" \"$(route_for health)\" \"$(route_for unknown)\"",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "/workspace/app|staging|/healthz|/404\n");
  } finally {
    await h2.dispose();
  }
});

test("set -a (allexport) persisted across turns automatically exports variables assigned in later turns", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    await session.exec("set -a");
    session.state = JSON.parse(JSON.stringify(session.state));

    await session.exec("AUTO_EXPORTED_VAR='visible-to-children'");
    const res = await session.exec("printenv AUTO_EXPORTED_VAR");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "visible-to-children\n");
  });
});

test("edge-case variable values (newlines, quotes, dollar signs, backslashes, UTF-8, empty) survive snapshot round-trips", async () => {
  await withE2EHarness(async (h) => {
    const session = h.shell.createSession();

    const t1 = await session.exec([
      "EMPTY_VAL=''",
      "MULTILINE=$'line1\\nline2\\tindented'",
      "SPECIAL='single\"double$VAR`backtick`\\slash'",
      "UNICODE='🦀 Rust → Shell ✓'",
    ].join("\n"));
    assert.equal(t1.exitCode, 0, t1.stderr);

    session.state = JSON.parse(JSON.stringify(session.state));

    const t2 = await session.exec(
      "printf 'empty=<%s>\\nml=<%s>\\nspec=<%s>\\nuni=<%s>\\n' \"$EMPTY_VAL\" \"$MULTILINE\" \"$SPECIAL\" \"$UNICODE\"",
    );
    assert.equal(t2.exitCode, 0, t2.stderr);
    assert.equal(
      t2.stdout,
      [
        "empty=<>",
        "ml=<line1",
        "line2\tindented>",
        "spec=<single\"double$VAR`backtick`\\slash>",
        "uni=<🦀 Rust → Shell ✓>",
        "",
      ].join("\n"),
    );
  });
});
