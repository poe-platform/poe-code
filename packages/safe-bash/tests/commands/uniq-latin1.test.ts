import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { textCommands } from "../../src/commands/text.js";
import { Shell } from "../../src/shell/index.js";
import { chunks, fixture, run } from "./helpers.js";

const latin1 = "en_US.ISO-8859-1";

for (const [env, folded] of [
  [{ LC_ALL: latin1 }, true],
  [{ LC_ALL: "C", LC_CTYPE: latin1, LANG: latin1 }, false],
  [{ LC_ALL: "POSIX" }, false],
  [{ LC_ALL: "C.utf8" }, false],
  [{ LC_ALL: "", LC_CTYPE: latin1, LANG: "C" }, true],
  [{ LC_CTYPE: "", LANG: latin1 }, true],
  [{ LC_CTYPE: latin1, LC_COLLATE: "invalid" }, false],
  [{ LC_ALL: "invalid.ISO-8859-1" }, false],
] as const) {
  test(`uniq -i preserves original Latin-1 records: ${JSON.stringify(env)}`, async () => {
    const input = Buffer.from("c90ae90a", "hex");
    for (const source of ["stdin", "file"]) {
      const fs = await fixture({ in: input });
      const result = await run("uniq", ["-i", ...(source === "file" ? ["in"] : [])], {
        fs, commands: textCommands(), stdin: chunks(input), env,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, folded ? input.subarray(0, 2) : input);
      assert.deepEqual(Buffer.from(await fs.readFile("/work/in")), input);
    }
  });
}

test("uniq folds Latin-1 case pairs but keeps nonletters and unpaired letters distinct", async () => {
  // Latin-1 has no uppercase byte for micro sign, sharp s, or y diaeresis.
  for (const [upper, lower, folded] of [
    [0x41, 0x61, true], [0xc0, 0xe0, true], [0xd6, 0xf6, true],
    [0xd8, 0xf8, true], [0xde, 0xfe, true], [0xd7, 0xf7, false],
    [0x9f, 0xb5, false], [0xbf, 0xdf, false], [0xdf, 0xff, false],
  ] as const) {
    const input = Uint8Array.of(lower, 0, upper, 0);
    const result = await run("uniq", ["-iz"], { commands: textCommands(), stdin: chunks(input), env: { LC_ALL: latin1 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Buffer.from(folded ? input.subarray(0, 2) : input));
  }
  const input = Buffer.from("c90ae90a", "hex");
  const sensitive = await run("uniq", [], { commands: textCommands(), stdin: input, env: { LC_ALL: latin1 } });
  assert.deepEqual(sensitive.stdoutBytes, input);
});

test("uniq applies Latin-1 folding after field, character and width selection", async () => {
  const input = Buffer.from("412078c9c2a10a422079e9c2a20a", "hex");
  for (const [args, expected] of [
    [["-if1", "-s2", "-w1"], "412078c9c2a10a"],
    [["-icf1", "-s2", "-w1"], "2020202020203220412078c9c2a10a"],
    [["-i", "-s4", "-w1"], "412078c9c2a10a"],
  ] as const) {
    const result = await run("uniq", args, { commands: textCommands(), stdin: input, env: { LC_ALL: latin1 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Buffer.from(expected, "hex"));
  }
});

test("uniq shell file, redirection, pipeline and substitution routes retain Latin-1 bytes", async context => {
  const fs = await fixture({ in: Buffer.from("c90ae90a", "hex") });
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: latin1 } });
  for (const command of [...basicCommands(), ...textCommands()]) shell.commands.register(command);
  context.after(() => shell.dispose());
  for (const source of ["uniq -i in", "uniq -i < in", "printf '\\311\\n\\351\\n' | uniq -i"]) {
    for (const script of [source, `x=$(${source}); printf '%s\\n' "$x"`, `for ((i=0;i<40;i++)); do ${source}; done`]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, script);
      assert.equal(result.stderr, "", script);
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from("c90a".repeat(script.startsWith("for ") ? 40 : 1), "hex"), script);
    }
  }
});
