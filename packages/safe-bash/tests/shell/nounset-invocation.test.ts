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
          assert.equal(result.exitCode, 1);
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
