import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, moreCommands, createMoreCommands, agentCommands } from "../../src/index.js";

for (const option of ["-n 1", "-n1", "--lines=1", "--lines 1", "-1"]) {
  test(`more consumes screen length ${option} without truncating piped output`, async t => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`printf 'a\\nb\\nc\\n' > f; more ${option} f | tail -1; echo "st=\${PIPESTATUS[0]}"`);
    assert.equal(result.stdout, "c\nst=0\n", result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const option of ["-n", "-n invalid", "--lines", "--lines=invalid"]) {
  test(`more rejects invalid screen length ${option}`, async t => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(moreCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`more ${option}`, { stdin: "a\nb\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /numeric value required/);
  });
}

test("less -n remains a flag and more respects the end of options", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/1", new TextEncoder().encode("one\n"));
  await fs.writeFile("/-n", new TextEncoder().encode("literal\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  t.after(() => shell.dispose());
  for (const [command, output] of [["less -N -n /1", "one\n"], ["more -- -n", "literal\n"]]) {
    const result = await shell.exec(command!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, "");
  }
});

test("standalone more registers only more and enforces its configured quota", async t => {
  assert.deepEqual(createMoreCommands().map(command => command.name), ["more"]);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(moreCommands({ maxInputBytes: 3 }));
  t.after(() => shell.dispose());
  assert.equal((await shell.exec("less", { stdin: "ab" })).exitCode, 127);
  const accepted = await shell.exec("more", { stdin: "abc" });
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(accepted.stdout, "abc");
  const rejected = await shell.exec("more", { stdin: "abcd" });
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /maximum size of 3 bytes/);
});
