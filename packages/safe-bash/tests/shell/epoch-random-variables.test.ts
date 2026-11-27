import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const maxExpansionBytes of [undefined, 65536]) {
  test(`epoch and entropy variables are set, budget ${maxExpansionBytes}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work", limits: { maxExpansionBytes } }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('echo "${EPOCHSECONDS:+set}|${EPOCHREALTIME:+set}|${SRANDOM:+set}"');
    assert.equal(result.stdout, "set|set|set\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  test(`epoch and entropy reads stay dynamic, budget ${maxExpansionBytes}`, async context => {
    let now = 1700000000123;
    let random = 0;
    context.mock.method(Date, "now", () => now);
    context.mock.method(globalThis.crypto, "getRandomValues", (sample: Uint32Array) => {
      sample[0] = random;
      return sample;
    });
    const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxExpansionBytes } }).use(agentCommands());
    shell.register({ name: "advance", async execute() { now += 1001; random = 0xffffffff; return { exitCode: 0 }; } });
    context.after(() => shell.dispose());
    const result = await shell.exec(`
      set -u
      EPOCHSECONDS=1; EPOCHREALTIME=2; SRANDOM=3
      f() { printf '%s|%s|%s\\n' "$EPOCHSECONDS" "$EPOCHREALTIME" "$SRANDOM"; }
      for i in 1 2; do
        f
        a=$EPOCHSECONDS; b=$EPOCHREALTIME; c=$SRANDOM
        echo "$a|$b|$c"
        echo "$((EPOCHSECONDS))|$((SRANDOM))"
        echo "$(echo "$EPOCHSECONDS|$EPOCHREALTIME|$SRANDOM")"
        advance
      done
    `);
    assert.equal(result.stdout, [
      "1700000000|1700000000.123000|0",
      "1700000000|1700000000.123000|0",
      "1700000000|0",
      "1700000000|1700000000.123000|0",
      "1700000001|1700000001.124000|4294967295",
      "1700000001|1700000001.124000|4294967295",
      "1700000001|4294967295",
      "1700000001|1700000001.124000|4294967295",
      "",
    ].join("\n"));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  test(`epoch and entropy references use live values, budget ${maxExpansionBytes}`, async context => {
    context.mock.method(Date, "now", () => 1700000000007);
    let random = 40;
    context.mock.method(globalThis.crypto, "getRandomValues", (sample: Uint32Array) => {
      sample[0] = ++random;
      return sample;
    });
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs, limits: { maxExpansionBytes } }).use(agentCommands());
    context.after(() => shell.dispose());
    await fs.writeFile("/script", new TextEncoder().encode(`
      echo "$((EPOCHSECONDS + 1))"
      ref=EPOCHSECONDS; echo "\${!ref}"
      declare -n stamp=EPOCHREALTIME; echo "$stamp"
      printf -v EPOCHSECONDS %s 1; read EPOCHREALTIME <<< 2
      echo "$EPOCHSECONDS|$EPOCHREALTIME"
      echo "$SRANDOM $SRANDOM"
    `));
    const result = await shell.exec("bash /script");
    assert.equal(result.stdout, "1700000001\n1700000000\n1700000000.007000\n1700000000|1700000000.007000\n41 42\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  test(`unsetting epoch and entropy variables removes special behavior, budget ${maxExpansionBytes}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxExpansionBytes } }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`
      (unset EPOCHSECONDS EPOCHREALTIME SRANDOM; echo "\${EPOCHSECONDS-unset}|\${EPOCHREALTIME-unset}|\${SRANDOM-unset}")
      echo "\${EPOCHSECONDS:+set}|\${EPOCHREALTIME:+set}|\${SRANDOM:+set}"
      unset EPOCHSECONDS EPOCHREALTIME SRANDOM
      echo "\${EPOCHSECONDS-unset}|\${EPOCHREALTIME-unset}|\${SRANDOM-unset}"
      EPOCHSECONDS=1; EPOCHREALTIME=2; SRANDOM=3
      echo "$EPOCHSECONDS|$EPOCHREALTIME|$SRANDOM"
    `);
    assert.equal(result.stdout, "unset|unset|unset\nset|set|set\nunset|unset|unset\n1|2|3\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
