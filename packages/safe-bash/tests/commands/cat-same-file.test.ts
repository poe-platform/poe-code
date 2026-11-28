import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell, agentCommands } from "../../src/index.js";
import { fixture } from "./helpers.js";

test("cat skips its output operand and continues copying other files", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  const result = await shell.exec('echo x > f; cat f >> f; echo "st=$?"; cat f; echo y > g; cat f g > g; echo "st=$?"; cat g');
  assert.equal(result.stdout, "st=1\nx\nst=1\nx\n");
  assert.equal(result.stderr, "cat: f: input file is output file\ncat: g: input file is output file\n");
  assert.equal(result.exitCode, 0);
});

for (const flags of ["", "-n"]) {
  test(`cat ${flags} detects symlink and hard-link aliases`, async () => {
    const shell = new Shell({ fs: await fixture({ f: "x\n" }), cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`ln -s f sym; ln f hard; cat ${flags} sym hard ./f >> f; echo "st=$?"; cat f`);
    assert.equal(result.stdout, "st=1\nx\n");
    assert.equal(result.stderr, "cat: sym: input file is output file\ncat: hard: input file is output file\ncat: ./f: input file is output file\n");
    assert.equal(result.exitCode, 0);
  });
}

test("cat refuses stdin that is also its output without looping", () => {
  const source = new URL("../../src/index.ts", import.meta.url).href;
  const helpers = new URL("./helpers.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--conditions=poe-code-source", "--input-type=module", "-e", `
    import { Shell, agentCommands } from ${JSON.stringify(source)};
    import { fixture } from ${JSON.stringify(helpers)};
    const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
    const result = await shell.exec('echo hi > g; cat < g >> g; echo "st=$?"; cat - < g >> g; echo "st=$?"; cat g');
    process.stdout.write(JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }));
  `], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    stdout: "st=1\nst=1\nhi\n",
    stderr: "cat: -: input file is output file\ncat: -: input file is output file\n",
    exitCode: 0,
  });
});
