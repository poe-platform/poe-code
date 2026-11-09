import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

for (const [options, first, rest, tail] of [
  ["-N2", "on", "e two", "three\n"],
  ["-N2 -n1", "o", "ne two", "three\n"],
  ["-N0", "", "one two", "three\n"],
  ["-N20", "one two\nthree\n", "", ""],
]) {
  for (const redirected of [false, true]) {
    test(`read ${options} preserves consumption and assignments before an invalid destination (${redirected ? "file" : "stdin"})`, async context => {
      const { shell, fs } = setup();
      context.after(() => shell.dispose());
      const input = "one two\nthree\n";
      const source = `later=keep; { read ${options} first bad-name later; code=$?; read rest; args "$code" "\${first-unset}" "$later" "$rest"; pass; }`;
      if (redirected) await fs.writeFile("/data", Buffer.from(input));
      const result = await shell.exec(redirected ? `${source} </data` : source, { stdin: redirected ? "" : input });
      assert.equal(result.stdout, JSON.stringify(["1", first, "keep", rest]) + tail);
      assert.equal(result.stderr, "shell: line 1: read: `bad-name': not a valid identifier\n");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("read -N rejects an invalid first destination before consuming input", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec('value=old; read -N2 bad-name value; args "$?" "$value"; pass', { stdin: "untouched" });
  assert.equal(result.stdout, '["1","old"]untouched');
  assert.equal(result.stderr, "shell: line 1: read: `bad-name': not a valid identifier\n");
  assert.equal(result.exitCode, 0);
});

for (const flag of ["n", "N"]) {
  for (const value of ["+2", " 2 ", "\t2\t", "2\n", "\n2\n", "02", "-0", "+0"]) {
    test(`default read -${flag} accepts signed and padded count ${JSON.stringify(value)}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const zero = Number(value) === 0;
      const result = await shell.exec(`read -${flag} '${value}' first; status=$?; read -r rest; args "$status" "$first" "$rest"; pass`, { stdin: "abcd\nTAIL\n" });
      assert.equal(result.stdout, JSON.stringify(["0", zero ? "" : "ab", zero ? "abcd" : "cd"]) + "TAIL\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
  for (const value of ["", " ", "+", "-1", "2x", "2 0", "0x2", "1.5", "1e2", "9007199254740992", "\u00a02"]) {
    test(`default read -${flag} rejects invalid count ${JSON.stringify(value)} without consuming input`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`read -${flag} '${value}' first; args "$?"; pass`, { stdin: "untouched" });
      assert.equal(result.stdout, JSON.stringify([flag === "N" || value === "9007199254740992" ? "1" : "2"]) + "untouched");
      assert.ok(result.stderr.includes("read:"));
    });
  }
  for (const count of ["2147483648", "4294967296", "9007199254740991", "9007199254740992"]) {
    for (const attached of [false, true]) {
      test(`default read -${flag} rejects ${count} (${attached ? "attached" : "separate"}) without consuming input`, async () => {
        const { shell } = setup();
        try {
          const result = await shell.exec(
            `saved=old; read -${flag}${attached ? "" : " "}${count} first; code=$?; read -${flag} ${count} saved; read -r rest; args "$code" "\${first-unset}" "$saved" "$rest"; pass; exit "$code"`,
            { stdin: "abcd\nTAIL\n" },
          );
          assert.equal(result.exitCode, 1);
          assert.equal(result.stdout, '["1","unset","old","abcd"]TAIL\n');
          assert.equal(result.stderr, `shell: line 1: read: ${count}: invalid number\nshell: line 1: read: ${count}: invalid number\n`);
        } finally { await shell.dispose(); }
      });
    }
  }
  test(`default read -${flag} accepts the signed 32-bit maximum`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`read -${flag} 2147483647 first; args "$?" "$first"; pass`, { stdin: "abcd\nTAIL\n" });
      assert.equal(result.stdout, flag === "n" ? '["0","abcd"]TAIL\n' : '["1","abcd\\nTAIL\\n"]');
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
