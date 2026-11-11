import assert from "node:assert/strict";
import test from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { standardCommands } from "../../src/commands/index.js";
import { joinCommands } from "../../src/commands/join/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, runTable } from "./table-text/helpers.js";

for (const flag of ["-a", "-v"]) {
  test(`join ${flag} decimal file selectors work directly and in command substitution`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/left", Buffer.from("k AA\nz ZZ\n"));
    await fs.writeFile("/right", Buffer.from("k BB\ny YY\n"));
    const shell = new Shell({ fs }).use(standardCommands()).use(joinCommands());
    context.after(() => shell.dispose());
    for (const [selector, unpaired] of [["+1", "z ZZ\n"], ["01", "z ZZ\n"], ["+2", "y YY\n"], ["02", "y YY\n"]]) {
      for (const args of [`${flag} ${selector}`, `${flag}${selector}`]) {
        const command = `join ${args} /left /right`;
        const expected = (flag === "-a" ? "k AA BB\n" : "") + unpaired;
        for (const source of [
          command,
          `x=$(${command}); status=$?; printf '%s\\n' "$x"; exit "$status"`,
          `for ((i=0;i<2;i++)); do x=$(${command}); status=$?; done; printf '%s\\n' "$x"; exit "$status"`,
        ]) {
          const result = await shell.exec(source);
          assert.equal(result.exitCode, 0, `${source}: ${result.stderr}`);
          assert.equal(result.stdout, expected, source);
          assert.equal(result.stderr, "", source);
        }
      }
    }
  });
}

for (const capture of [false, true]) {
  test(`join split output list preserves filenames through Shell: capture=${capture}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/1.2", Buffer.from("k A\n"));
    await fs.writeFile("/2.2", Buffer.from("k B\n"));
    const shell = new Shell({ fs, cwd: "/", env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      for (const [command, expected] of [
        ["join -o 0 1.2 2.2 1.2 2.2", "k A B\n"],
        ["join -o 0 1.2 2.2", "k\n"],
        ["join -o 0 1.2 -- 1.2 2.2", "k A\n"],
      ]) {
        const actual = await shell.exec(capture ? `result=$(${command}); printf '%s\\n' "$result"` : command!);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.equal(actual.stderr, "");
        assert.equal(actual.stdout, expected);
      }
    } finally { await shell.dispose(); }
  });
}

for (const capture of [false, true]) {
 for (const [options, expected, exitCode] of [
  ["-e $'\\xff'", [255, 10], 0],
  ["-ie$'\\xfe\\xff'", [254, 255, 10], 0],
  ["-e $'\\xff' -e $'\\xff'", [255, 10], 0],
  ["-e $'\\xfe' -e $'\\xff'", [], 1],
  ["-e $'\\xff' -e '�'", [], 1],
  ["-e NA", [78, 65, 10], 0],
 ] as const) {
  test(`join replacement bytes through Shell: capture=${capture}, ${options}`, async () => {
   const fs = createMemoryFileSystem();
   await fs.writeFile("/left", new TextEncoder().encode("k A\n"));
   await fs.writeFile("/right", new TextEncoder().encode("k B\n"));
   const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(joinCommands());
   const command = `join -o 1.3 ${options} /left /right`;
   try {
    const actual = await shell.exec(capture ? `value=$(${command}); status=$?; if [ "$status" = 0 ]; then printf '%s\\n' "$value"; fi; exit "$status"` : command);
    assert.equal(actual.exitCode, exitCode, actual.stderr);
    assert.deepEqual(actual.stdoutBytes, Uint8Array.from(expected));
    assert.equal(actual.stderr, exitCode ? "join: conflicting empty-field replacement strings\n" : "");
   } finally { await shell.dispose(); }
  });
 }
}

for (const option of ["-t $'\\xff'", "-t$'\\xff'", "-it$'\\xff'"]) {
 for (const capture of [false, true]) {
  test(`join preserves a raw delimiter through Shell: ${option}, capture=${capture}`, async context => {
   const fs = createMemoryFileSystem();
   const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(joinCommands());
   context.after(() => shell.dispose());
   const command = `join ${option} left right`;
   const result = await shell.exec(String.raw`printf 'k\xffA\n' > left; printf 'k\xffB\n' > right; ` +
    (capture ? `x=$(${command}); status=$?; printf '%s\\n' "$x"; exit "$status"` : command));
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.deepEqual(result.stdoutBytes, Uint8Array.of(107, 255, 65, 255, 66, 10));
  });
 }
}

// GNU coreutils 9.10 ignores trailing blanks; 9.4 retained an extra empty field.
for (const [name, left, right, args, expected] of [
  ["LF-terminated files", "a 1\n", "a x\n", [], "a 1 x\0"],
  ["terminated NUL records", "a 1\n\0", "a x\n\0", [], "a 1 x\0"],
  ["space and tab tails", "a 1 \0", "a x\t\0", [], "a 1 x\0"],
  ["collapsed LF blanks", "\na\n 1\n\n\0", "a\tx\0", [], "a 1 x\0"],
  ["no trailing blanks", "a 1\0", "a x\0", [], "a 1 x\0"],
  ["explicit empty-field replacement", "a 1\n\0", "a x\n\0", ["-e", "M", "-o", "0,1.2,1.3,2.2,2.3"], "a 1 M x M\0"],
  ["automatic empty-field replacement", "a 1\n\0", "a x\n\0", ["-e", "M", "-o", "auto"], "a 1 x\0"],
  ["default empty-field replacement", "k A  \0", "k X\0", ["-e", "NA"], "k A X\0"],
  ["automatic field count", "k A  \0", "k X\0", ["-o", "auto"], "k A X\0"],
  ["explicit delimiter preserves LF", "a:1\n\0", "a:x\n\0", ["-t", ":"], "a:1\n:x\n\0"],
  ["explicit delimiter preserves empty fields", "a:1:\0", "a:x:\0", ["-t", ":", "-e", "M"], "a:1:M:x:M\0"],
  ["explicit blank delimiter preserves empty fields", "a 1 \0", "a x \0", ["-t", " ", "-e", "M", "-o", "auto"], "a 1 M x M\0"],
  ["blank-only records", "\n\0", "\t\0", [], "\0"],
] as const) {
  test(`join -z ${name} matches GNU field spacing`, async () => {
    const actual = await runTable(fixture("join", ["-z", ...args, "left", "right"], { left, right }));
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdoutHex, Buffer.from(expected).toString("hex"));
  });
}

test("join -z counts only actual whitespace-separated fields against the field limit", async () => {
  const actual = await runTable(fixture("join", ["-z", "left", "right"], {
    left: "a 1\n", right: "a x\n",
  }), { limits: { maxFields: 2 } });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stderr, "");
  assert.equal(actual.stdoutHex, Buffer.from("a 1 x\0").toString("hex"));
});

test("join -z still counts explicit trailing empty fields against the field limit", async () => {
  const actual = await runTable(fixture("join", ["-z", "-t", ":", "left", "right"], {
    left: "a:1:\0", right: "a:x\0",
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
    assert.deepEqual(actual.stdoutBytes, Uint8Array.from([97, 32, 255, 32, 120, 0]));
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
