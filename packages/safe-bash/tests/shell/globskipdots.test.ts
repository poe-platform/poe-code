import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";

for (const arrays of [false, true]) test(`globskipdots defaults on and can be disabled and restored (arrays=${arrays})`, async () => {
  const { shell } = setup({ extensions: arrays ? [arraysExtension()] : [] });
  shell.use(standardCommands());
  try {
    const result = await shell.exec('mkdir d; touch d/.env; shopt -q globskipdots; echo "default=$?"; shopt -u globskipdots; printf "%s\\n" d/.*; shopt -s globskipdots; printf "%s\\n" d/.*');
    assert.equal(result.stdout, "default=0\nd/.\nd/..\nd/.env\nd/.env\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const recursive of [false, true]) {
  for (const [pattern, names] of [
    [".*", [".", "..", ".env"]],
    [".?", [".."]],
    [".[.]", [".."]],
    ['"."*', [".", "..", ".env"]],
    ["\\.*", [".", "..", ".env"]],
    ["*", ["plain"]],
    ["[.]*", ["[.]*"]],
    [".*/", ["../", "./"]],
    [".*/*", ["../d", "./plain"]],
  ] as const) {
    test(`globskipdots off matches ${pattern} (recursive=${recursive})`, async () => {
      const { fs, shell } = setup({ cwd: "/work" });
      await fs.mkdir("/work/d", { recursive: true });
      await fs.writeFile("/work/d/.env", new Uint8Array());
      await fs.writeFile("/work/d/plain", new Uint8Array());
      const prefix = recursive ? "d/**/" : "d/";
      try {
        const result = await shell.exec(`shopt -u globskipdots; ${recursive ? "shopt -s globstar; " : ""}args ${prefix}${pattern}`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
        assert.deepEqual(JSON.parse(result.stdout), names.map(name => `${name === "[.]*" ? prefix : "d/"}${name}`));
      } finally { await shell.dispose(); }
    });
  }

  test(`globskipdots off respects dotglob and GLOBIGNORE (recursive=${recursive})`, async () => {
    const { fs, shell } = setup();
    await fs.mkdir("/d");
    await fs.writeFile("/d/.env", new Uint8Array());
    await fs.writeFile("/d/plain", new Uint8Array());
    const prefix = recursive ? "d/**/" : "d/";
    try {
      const result = await shell.exec(`shopt -u globskipdots; shopt -s dotglob globstar; args ${prefix}*; GLOBIGNORE=nomatch; args ${prefix}.*`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, '["d/.env","d/plain"]["d/.env"]');
    } finally { await shell.dispose(); }
  });
}

test("sessions retain globskipdots and subshells inherit it without changing the parent", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/d");
  await fs.writeFile("/d/.env", new Uint8Array());
  try {
    const session = shell.createSession();
    assert.equal((await session.exec("shopt -p globskipdots")).stdout, "shopt -s globskipdots\n");
    assert.equal((await session.exec("shopt -u globskipdots")).exitCode, 0);
    assert.equal(session.state?.options?.globskipdots, false);
    const result = await session.exec("(args d/.*; shopt -s globskipdots); args d/.*; bash -c 'shopt -p globskipdots'");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '["d/.","d/..","d/.env"]["d/.","d/..","d/.env"]shopt -s globskipdots\n');
  } finally { await shell.dispose(); }
});

test("cached loops and independent executions honor globskipdots changes", async () => {
  const { shell, fs } = setup({ extensions: [arraysExtension()] });
  shell.use(standardCommands());
  await fs.mkdir("/d");
  await fs.writeFile("/d/.env", new Uint8Array());
  try {
    const result = await shell.exec(`f() { for ((i=0; i<2; i++)); do for x in d/.*; do printf '<%s>' "$x"; done; done; }
f
shopt -u globskipdots
f
shopt -s globskipdots
f`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '<d/.env><d/.env><d/.><d/..><d/.env><d/.><d/..><d/.env><d/.env><d/.env>');
    assert.equal((await shell.exec("shopt -u globskipdots")).exitCode, 0);
    assert.equal((await shell.exec("shopt -p globskipdots")).stdout, "shopt -s globskipdots\n");
  } finally { await shell.dispose(); }
});

for (const [pattern, names] of [
  ["@(.|..)", [".", ".."]],
  ["?(.)", ["."]],
  ["+(.)", [".", ".."]],
  ["*(.)", [".", ".."]],
  ["?(x).", ["."]],
  ["*(x).", ["."]],
  ["@([.]|..)", [".."]],
  ["@(*|.)", [".", "plain"]],
  ["!(foo)", ["plain"]],
  ["*([.])", ["*([.])"]],
] as const) {
  test(`globskipdots off requires an explicit dot in ${pattern}`, async () => {
    const { shell, fs } = setup();
    await fs.mkdir("/d");
    await fs.writeFile("/d/plain", new Uint8Array());
    try {
      const result = await shell.exec(`shopt -s extglob\nshopt -u globskipdots\nargs d/${pattern}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.deepEqual(JSON.parse(result.stdout), names.map(name => `d/${name}`));
    } finally { await shell.dispose(); }
  });
}
