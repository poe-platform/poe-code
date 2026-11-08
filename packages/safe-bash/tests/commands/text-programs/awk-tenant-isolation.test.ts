import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

const cases = [
  ["arrays", '{ sum[$1] += $2 } END { print sum["alice"], sum["bob"] }', "25 20\n"],
  ["environment", 'END { print ENVIRON["TENANT"] }', "second\n"],
  ["separators", 'BEGIN { FS=" "; OFS=":"; ORS="!" } { print $1, $2 }', "alice:10!bob:20!alice:15!"],
  ["formats", 'BEGIN { OFMT="%.2f"; CONVFMT="%.3f" } END { x=1/3; print x, x "" }', "0.33 0.333\n"],
] as const;

for (const sameShell of [false, true]) {
  for (const [name, program, expected] of cases) {
    test(`awk ${name} after a prior invocation (${sameShell ? "same" : "independent"} shell)`, async t => {
      const first = new Shell({ fs: createMemoryFileSystem(), env: { TENANT: "first" } });
      first.use(agentCommands());
      t.after(() => first.dispose());
      const second = sameShell ? first : new Shell({ fs: createMemoryFileSystem() });
      if (!sameShell) { second.use(agentCommands()); t.after(() => second.dispose()); }
      for (let repeat = 0; repeat < 3; repeat++) {
        const warmup = await first.exec(`printf '1\\n2\\n' | awk '{ print $1 }'`);
        assert.equal(warmup.exitCode, 0, warmup.stderr);
        assert.equal(warmup.stdout, "1\n2\n");
        const result = await second.exec(`printf 'alice 10\\nbob 20\\nalice 15\\n' | TENANT=second awk '${program}'`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
        const defaults = await second.exec(`awk 'BEGIN { print FS==" ", OFS==" ", ORS=="\\n", RS=="\\n", SUBSEP=="\\034", OFMT=="%.6g", CONVFMT=="%.6g", length(sum) }'`);
        assert.equal(defaults.exitCode, 0, defaults.stderr);
        assert.equal(defaults.stdout, "1 1 1 1 1 1 1 0\n");
      }
    });
  }
}

test("concurrent awk tenants retain separate arrays, environment, fields and output", async t => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = new Shell({ fs: createMemoryFileSystem(), env: { TENANT: "first" } });
  const second = new Shell({ fs: createMemoryFileSystem(), env: { TENANT: "second" } });
  first.use(agentCommands()); second.use(agentCommands());
  t.after(() => first.dispose()); t.after(() => second.dispose());
  const input = async function* () {
    yield new TextEncoder().encode("alice:10\n");
    entered();
    await gate;
    yield new TextEncoder().encode("alice:15\n");
  };
  const pending = first.exec(`awk -F: '{ sum[$1]+=$2 } END { OFS=":"; print ENVIRON["TENANT"], sum["alice"] }'`, { stdin: input() });
  try {
    await waiting;
    const result = await second.exec(`printf 'bob 7\\n' | awk '{ sum[$1]+=$2 } END { print ENVIRON["TENANT"], sum["bob"], sum["alice"]+0 }'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "second 7 0\n");
  } finally { release(); }
  const result = await pending;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "first:25\n");
});
