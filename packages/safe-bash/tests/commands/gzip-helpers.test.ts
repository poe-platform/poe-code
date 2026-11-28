import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/index.js";

for (const [script, stdout, exitCode] of [
  ["zgrep hi a.gz; zgrep -c hi a.gz; zgrep -H hi a a.gz; zcmp a.gz a.gz; echo st=$?; zdiff a a.gz; echo st=$?", "hi\n1\na:hi\na.gz:hi\nst=0\nst=0\n", 0],
  ["zgrep hi a a.gz", "a:hi\na.gz:hi\n", 0],
  ["zgrep -h hi a a.gz", "hi\nhi\n", 0],
  ["echo hi > patterns; zgrep -f patterns a.gz", "hi\n", 0],
  ["zgrep -e hi a.gz", "hi\n", 0],
  ["cat a.gz a.gz > twice.gz; zgrep -c hi twice.gz", "2\n", 0],
  ["zcmp -n 1 a.gz a", "", 0],
  ["zdiff -u a a.gz", "", 0],
  ["zgrep hi a.gz", "hi\n", 0],
  ["zgrep -c hi a.gz", "1\n", 0],
  ["zgrep -H hi a a.gz", "a:hi\na.gz:hi\n", 0],
  ["zcmp a.gz a.gz; echo st=$?", "st=0\n", 0],
  ["zdiff a a.gz; echo st=$?", "st=0\n", 0],
  ["zegrep 'hi|bye' a.gz", "hi\n", 0],
  ["zfgrep 'h.' a.gz", "", 1],
  ["zless a.gz", "hi\n", 0],
  ["zmore a.gz", "hi\n", 0],
  ["cat a.gz | zgrep hi", "hi\n", 0],
  ["zgrep -l hi a.gz", "a.gz\n", 0],
  ["echo bye > b; gzip -k b; zcmp a.gz b.gz >/dev/null", "", 1],
  ["zdiff a.gz", "", 0],
] as const) {
  test(script, async t => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`echo hi > a; gzip -k a; ${script}`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, exitCode);
  });
}

for (const name of ["zgrep", "zegrep", "zfgrep", "zdiff", "zcmp", "zless", "zmore"]) {
  test(`${name} rejects corrupt gzip without modifying the input`, async t => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    t.after(() => shell.dispose());
    await shell.exec("echo hi > a; gzip -k a");
    const compressed = await fs.readFile("/a.gz");
    const damaged = compressed.slice(0, -4);
    await fs.writeFile("/broken.gz", damaged);
    const args = name.includes("grep") ? "hi broken.gz" : name === "zcmp" || name === "zdiff" ? "a broken.gz" : "broken.gz";
    const result = await shell.exec(`${name} ${args}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.length > 0);
    assert.deepEqual(await fs.readFile("/broken.gz"), damaged);
  });
}
