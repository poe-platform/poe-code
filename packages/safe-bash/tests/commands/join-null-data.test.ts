import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, runTable } from "./table-text/helpers.js";

// Expected bytes were checked against GNU coreutils 9.4 with LC_ALL=C.
for (const [name, left, right, args, expected] of [
  ["LF-terminated files", "a 1\n", "a x\n", [], "a 1  x \0"],
  ["terminated NUL records", "a 1\n\0", "a x\n\0", [], "a 1  x \0"],
  ["space and tab tails", "a 1 \0", "a x\t\0", [], "a 1  x \0"],
  ["collapsed LF blanks", "\na\n 1\n\n\0", "a\tx\0", [], "a 1  x\0"],
  ["no trailing blanks", "a 1\0", "a x\0", [], "a 1 x\0"],
  ["explicit empty-field replacement", "a 1\n\0", "a x\n\0", ["-e", "M", "-o", "0,1.2,1.3,2.2,2.3"], "a 1 M x M\0"],
  ["automatic empty-field replacement", "a 1\n\0", "a x\n\0", ["-e", "M", "-o", "auto"], "a 1 M x M\0"],
  ["explicit delimiter preserves LF", "a:1\n\0", "a:x\n\0", ["-t", ":"], "a:1\n:x\n\0"],
  ["blank-only records", "\n\0", "\t\0", [], "\0"],
] as const) {
  test(`join -z ${name} matches GNU field spacing`, async () => {
    const actual = await runTable(fixture("join", ["-z", ...args, "left", "right"], { left, right }));
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdoutHex, Buffer.from(expected).toString("hex"));
  });
}

test("join -z admits the retained empty field against the field limit", async () => {
  const actual = await runTable(fixture("join", ["-z", "left", "right"], {
    left: "a 1\n", right: "a x\n",
  }), { limits: { maxFields: 2 } });
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stderr, "join: EFBIG: table-text field limit exceeded\n");
  assert.equal(actual.stdoutHex, "");
});

test("join --zero-terminated preserves spacing through Shell and agentCommands", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/second", Buffer.from("a x\n"));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
  const fragment = Buffer.from([97, 32, 255, 10]);
  let closed = false;
  const stdin = (async function* () {
    try { yield fragment; } finally { fragment.fill(88); closed = true; }
  })();
  try {
    const actual = await shell.exec("join --zero-terminated - /second > /joined; cat /joined", { stdin });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.deepEqual(actual.stdoutBytes, Uint8Array.from([97, 32, 255, 32, 32, 120, 32, 0]));
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});

test("join issue 1039 supports -j1/-j2 FIELD syntax and rejects conflicting join fields and -e strings", async () => {
  const j1 = await runTable(fixture("join", ["-j1", "2", "left", "right"], { left: "a 1\n", right: "1 b\n" }));
  assert.equal(j1.exitCode, 0, j1.stderr);
  assert.equal(Buffer.from(j1.stdoutHex, "hex").toString(), "1 a b\n");

  const j2 = await runTable(fixture("join", ["-j2", "2", "left", "right"], { left: "1 a\n", right: "b 1\n" }));
  assert.equal(j2.exitCode, 0, j2.stderr);
  assert.equal(Buffer.from(j2.stdoutHex, "hex").toString(), "1 a b\n");

  for (const args of [
    ["-1", "1", "-1", "2", "left", "right"],
    ["-2", "1", "-2", "2", "left", "right"],
    ["-j", "1", "-1", "2", "left", "right"],
  ]) {
    const res = await runTable(fixture("join", args, { left: "a 1\n", right: "1 b\n" }));
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /incompatible join fields 0, 1/u);
  }

  const conflictE = await runTable(fixture("join", ["-e", "A", "-e", "B", "left", "right"], { left: "a 1\n", right: "1 b\n" }));
  assert.equal(conflictE.exitCode, 1);
  assert.match(conflictE.stderr, /conflicting empty-field replacement strings/u);
});
