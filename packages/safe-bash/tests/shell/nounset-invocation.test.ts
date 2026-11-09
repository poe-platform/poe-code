import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const command of ["sh", "bash"]) {
  for (const flags of ["-u", "-eu", "-ue", "-o nounset"]) {
    test(`${command} ${flags} runs defined variables and preserves arguments`, async () => {
      const fs = createMemoryFileSystem();
      const shell = new Shell({ fs }).use(agentCommands());
      await fs.writeFile("/owned.sh", Buffer.from('owned=Independent; printf "%s\\n" "$owned"; printf "<%s>" "$0" "$1" "$2"; printf "[%s]" "$-"'));
      try {
        const result = await shell.exec(`${command} ${flags} /owned.sh arg ''`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, `Independent\n</owned.sh><arg><>[${flags.includes("e") && flags !== "-o nounset" ? "e" : ""}uB]`);
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
    for (const mode of ["file", "command", "stdin"]) {
      test(`${command} ${flags} enables nounset for ${mode}`, async () => {
        const fs = createMemoryFileSystem();
        const shell = new Shell({ fs }).use(agentCommands());
        const invoke = mode === "file" ? `${command} ${flags} /owned.sh arg` : mode === "command" ? `${command} ${flags} -c 'owned=Independent; printf "%s\\n" "$owned"; printf "%s" "$missing"; printf BAD' probe arg` : `${command} ${flags} -s arg`;
        const source = 'owned=Independent; printf "%s\\n" "$owned"; printf "%s" "$missing"; printf BAD';
        await fs.writeFile("/owned.sh", Buffer.from(source));
        try {
          const result = await shell.exec(invoke, { stdin: source });
          assert.equal(result.stdout, "Independent\n");
          assert.equal(result.exitCode, mode === "command" ? 127 : 1);
          assert.ok(result.stderr.includes("missing: unbound variable"), result.stderr);
        } finally { await shell.dispose(); }
      });
    }
  }
  for (const flags of ["-u +u", "-o nounset +o nounset", "-eu +eu"]) {
    test(`${command} ${flags} disables nounset without changing parent options`, async () => {
      const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
      try {
        const result = await shell.exec(`${command} ${flags} -c 'printf "<%s>" "$missing"'; printf "<%s>" "$missing"`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "<><>");
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
  }
  test(`${command} nounset does not leak into parent`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(`${command} -uc 'printf "%s" "$missing"'; printf '<%s>' "$missing"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "<>");
      assert.ok(result.stderr.includes("missing: unbound variable"));
    } finally { await shell.dispose(); }
  });
}

for (const [invocation, status, diagnostic] of [
  [`bash -c 'set -u; echo "$MISSING_SAMPLE"; echo BAD'`, 127, "MISSING_SAMPLE"],
  [`bash -uc 'echo "$1"; echo BAD'`, 127, "1"],
  [`bash -uc 'echo "$MISSING_SAMPLE"; echo BAD' named-child`, 127, "MISSING_SAMPLE"],
  [`bash -uc 'f() { echo "$MISSING_SAMPLE"; echo BAD; }; f; echo BAD'`, 127, "MISSING_SAMPLE"],
  [`bash -uc '(echo "$MISSING_SAMPLE"; echo BAD)'`, 1, "MISSING_SAMPLE"],
  [`bash -uc 'value=$(echo "$MISSING_SAMPLE"; echo BAD)'`, 1, "MISSING_SAMPLE"],
  [`bash -uc 'echo "$MISSING_SAMPLE" | cat; exit \${PIPESTATUS[0]}'`, 1, "MISSING_SAMPLE"],
  [`bash -uc 'bash -uc "echo \\$MISSING_SAMPLE"'`, 127, "MISSING_SAMPLE"],
] as const) {
  test(`nounset reports the child status to its parent: ${invocation}`, async t => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`${invocation}; printf "status=%s\\n" "$?"; printf parent`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `status=${status}\nparent`);
    assert.ok(result.stderr.includes(`${diagnostic}: unbound variable`), result.stderr);
  });
}

test("literal command invocation returns the nounset status", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  t.after(() => shell.dispose());
  shell.register({ name: "child", async execute(context) {
    return context.invoke!("bash", ["-uc", 'echo "$1"; echo BAD']);
  } });
  const result = await shell.exec("child");
  assert.equal(result.exitCode, 127);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("1: unbound variable"), result.stderr);
});

for (const mode of ["command", "file", "stdin"] as const) {
  test(`multiline nounset retains ${mode} execution status`, async t => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    t.after(() => shell.dispose());
    const source = 'set -u\necho "$MISSING_SAMPLE"\necho BAD\n';
    await fs.writeFile("/noun.sh", Buffer.from(source));
    const invocation = mode === "command" ? `bash -c '${source}'` : mode === "file" ? "bash /noun.sh" : "bash -s";
    const result = await shell.exec(invocation, { stdin: source });
    assert.equal(result.exitCode, mode === "command" ? 127 : 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${mode === "file" ? "/noun.sh" : "bash"}: line 2: MISSING_SAMPLE: unbound variable\n`);
  });
}
