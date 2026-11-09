import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createPasteCommands } from "../../src/commands/paste/index.js";

function shell() {
  return new Shell({ fs: new MemoryFileSystem() }).use({ name: "regression", setup(host) {
    for (const command of [...createStandardCommands(), ...createPasteCommands(), ...createStreamFormatCommands()]) host.commands.register(command);
  } });
}

for (const [operands, expected] of [
  ["-", "\n"],
  ["- -", "\n\n"],
  ["/empty /f1 /empty", "\nalpha\n\n"],
] as const) {
  for (const zero of [false, true]) {
    for (const pipeline of [false, true]) {
      test(`serial paste preserves empty records: ${operands}, zero=${zero}, pipeline=${pipeline}`, async () => {
        const command = `paste -s${zero ? "z" : ""} ${operands}`;
        const script = `printf '' > /empty; printf 'alpha${zero ? "\\0" : "\\n"}' > /f1; printf '' | ${command}${pipeline ? " | cat" : ""}`;
        const result = await shell().exec(script);
        assert.equal(result.stdout, zero ? expected.replaceAll("\n", "\0") : expected);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      });
    }
  }
}

for (const [locale, hex] of [
  ["LC_ALL=C", "61c362a9630a"],
  ["LC_ALL=POSIX", "61c362a9630a"],
  ["LC_ALL=C.UTF-8", "61c3a962c3a9630a"],
  ["LC_ALL=C LC_CTYPE=C.UTF-8 LANG=C.UTF-8", "61c362a9630a"],
  ["LC_ALL= LC_CTYPE=C LANG=C.UTF-8", "61c362a9630a"],
  ["LC_ALL= LC_CTYPE= LANG=C", "61c362a9630a"],
  ["LC_ALL= LC_CTYPE=C.UTF-8 LANG=C", "61c3a962c3a9630a"],
] as const) {
  for (const command of ["paste -sd 'é' /input", "paste -d 'é' - - - < /input", "cat /input | paste --serial --delimiters='é' -"]) {
    for (const capture of [false, true]) {
      test(`paste delimiter bytes: ${locale}, ${command}, capture=${capture}`, async () => {
        const result = await shell().exec(`export ${locale}; printf 'a\\nb\\nc\\n' > /input; ${capture ? `x=$(${command}); printf '%s\\n' "$x"` : command}`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from(hex, "hex")));
      });
    }
  }
}

for (const [command, expected] of [
  ["paste -", "from-stdin\n"],
  ["paste /f1 -", "alpha\tfrom-stdin\n"],
  ["paste - /f1", "from-stdin\talpha\n"],
  ["paste - -", "from-stdin\t\n"],
  ["paste -s -", "from-stdin\n"],
  ["paste", "from-stdin\n"],
] as const) {
  for (const input of ["<<< 'from-stdin'", "", "< /input"]) {
    test(`paste substitution inherits stdin: ${command} ${input}`, async () => {
      const result = await shell().exec(`printf 'alpha\\n' > /f1; printf 'from-stdin\\n' > /input; printf 'from-stdin\\n' | { x=$(${command}); printf '%s\\n' "$x"; } ${input}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    });
  }
}

for (const input of ["<<< 'from-stdin'", "< /input"]) {
  test(`paste substitution reads its own redirected stdin: ${input}`, async () => {
    const result = await shell().exec(`printf 'alpha\\n' > /f1; printf 'from-stdin\\n' > /input; x=$(paste /f1 - ${input}); printf '%s\\n' "$x"`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "alpha\tfrom-stdin\n");
  });
}

test("paste substitution preserves file-only and empty stdin inputs", async () => {
  const instance = shell();
  const files = await instance.exec(`printf 'alpha\\n' > /f1; printf 'beta\\n' > /f2; x=$(paste /f1 /f2); printf '%s\\n' "$x"`);
  assert.equal(files.stderr, "");
  assert.equal(files.exitCode, 0);
  assert.equal(files.stdout, "alpha\tbeta\n");
  const empty = await instance.exec(`x=$(paste -); printf '<%s>\\n' "$x"`);
  assert.equal(empty.stderr, "");
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.stdout, "<>\n");
});

for (const second of ["beta\\n", ""]) {
  test(`nl substitution preserves multiple file operands: ${JSON.stringify(second)}`, async () => {
    const setup = `printf 'alpha\\n' > /f1; printf '${second}' > /f2;`;
    const direct = await shell().exec(`${setup} nl /f1 /f2`);
    const substitution = await shell().exec(`${setup} x=$(nl /f1 /f2); printf '%s\\n' "$x"`);
    assert.equal(direct.stdout, second ? "     1\talpha\n     2\tbeta\n" : "     1\talpha\n");
    assert.deepEqual(substitution, direct);
  });
}

for (const [options, expected] of [
  ["-h all -b text -f none", "\n1|A\n2|\n\n1|A\n  \n\n  A\n  \n"],
  ["-hall! -bnone -ftext", "\n1|A\n2|\n\n  A\n  \n\n1|A\n  \n"],
  ["--header-numbering=none --body-numbering=all! --footer-numbering=text", "\n  A\n  \n\n1|A\n2|\n\n1|A\n  \n"],
  ["-hp'^A$' -btext -fnone", "\n1|A\n  \n\n1|A\n  \n\n  A\n  \n"],
] as const) {
  for (const input of ["/input", "< /input", "cat /input | "]) {
    test(`nl substitution accepts extended numbering styles: ${options}, ${input}`, async () => {
      const instance = shell();
      try {
        const page = "\\:\\:\\:\nA\n\n\\:\\:\nA\n\n\\:\nA\n\n";
        const command = input.endsWith("| ") ? `${input}nl -w1 -s'|' ${options}` : `nl -w1 -s'|' ${options} ${input}`;
        const result = await instance.exec(`printf '%s' '${page}' > /input; x=$(${command}); status=$?; printf '%s\\n' "$x"; exit "$status"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
      } finally { await instance.dispose(); }
    });
  }
}

for (const byte of ["ff", "80", "21"]) {
  for (const option of ["-d ", "-d", "--section-delimiter ", "--section-delimiter="]) {
    for (const route of ["pipeline", "pipeline substitution", "file substitution"]) {
      test(`nl raw section delimiter: ${byte}, ${option}, ${route}`, async () => {
        const input = `printf 'a\\n\\x${byte}:\\nb\\n'`;
        const command = `nl ${option}$'\\x${byte}'`;
        const script = route === "pipeline" ? `${input} | ${command}`
          : route === "pipeline substitution" ? `x=$(${input} | ${command}); printf '%s\\n' "$x"`
          : `${input} > /input; x=$(${command} /input); printf '%s\\n' "$x"`;
        const result = await shell().exec(`export LC_ALL=C; ${script}`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("     1\ta\n\n       b\n"));
      });
    }
  }
}
