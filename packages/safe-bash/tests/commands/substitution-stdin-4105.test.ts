import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { factorCommands } from "../../src/commands/factor/index.js";
import { tsortCommands } from "../../src/commands/tsort/index.js";
import { envsubstCommands } from "../../src/commands/envsubst/index.js";

function shell() {
  return new Shell({ fs: new MemoryFileSystem() }).use({ name: "regression", setup(host) {
    for (const command of [...basicCommands(), ...filesystemCommands()]) host.commands.register(command);
  } }).use(factorCommands()).use(tsortCommands()).use(envsubstCommands());
}

const cases = [
  ["envsubst", "hello $FOO $BAR", "hello world there"],
  ["envsubst '$FOO'", "hello $FOO $BAR", "hello world $BAR"],
  ["factor", "12", "12: 2 2 3"],
  ["factor -h", "12", "12: 2^2 3"],
  ["tsort", "a b", "a\nb"],
  ["tsort -", "a b", "a\nb"],
] as const;

for (const [command, input, expected] of cases) {
  for (const source of ["group here-string", "pipeline", "substitution here-string", "file redirect"]) {
    test(`${command} preserves stdin from ${source}`, async () => {
      const invocation = `x=$(${command}); printf '%s\\n' "$x";`;
      const script = source === "group here-string" ? `{ ${invocation} } <<< '${input}'`
        : source === "pipeline" ? `printf '%s\\n' '${input}' | { ${invocation} }`
        : source === "substitution here-string" ? `x=$(${command} <<< '${input}'); printf '%s\\n' "$x"`
        : `printf '%s\\n' '${input}' > /input; { ${invocation} } < /input`;
      const result = await shell().exec(`export FOO=world BAR=there; ${script}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected + "\n");
    });
  }
}

test("stdin-independent substitutions and relative tsort files remain valid", async () => {
  const result = await shell().exec(`mkdir /work; cd /work; printf 'a b\\n' > edges; echo "$(tsort edges)"; echo "$(factor 12)"; echo "$(envsubst --variables '$FOO $BAR')"`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "a\nb\n12: 2 2 3\nFOO\nBAR\n");
});

// Output/status captured from GNU gettext-runtime 0.21 with LC_ALL=C.
for (const [options, expectedOutput, expectedStatus] of [
  ["-vv '$A ${B} $A'", "A\nB\nA\n", 0],
  ["-vv -- '-$A'", "A\n", 0],
  ["-vv", "", 1],
  ["-vx '$A'", "", 1],
  ["-hx", "", 1],
  ["-Vx", "", 1],
  ["-vh", "help", 0],
  ["-hV", "version", 0],
  ["-Vh", "version", 0],
] as const) {
  test(`envsubst grouped options preserve direct and substitution results: ${options}`, async () => {
    const sh = shell();
    try {
      const expected = expectedOutput === "help" || expectedOutput === "version"
        ? (await sh.exec(`envsubst --${expectedOutput}`)).stdout
        : expectedOutput;
      const direct = await sh.exec(`envsubst ${options}`);
      assert.equal(direct.stdout, expected);
      assert.equal(direct.exitCode, expectedStatus);
      assert.equal(direct.stderr.length > 0, expectedStatus !== 0);
      for (const header of ["", "for i in 1 2; do", "for ((i=0;i<2;i++)); do"]) {
        const captured = await sh.exec(`${header}
value=$(envsubst ${options}); status=$?; printf '%s' "$value"
${header ? "done" : ""}
exit "$status"`);
        assert.equal(captured.stdout, expected.trimEnd().repeat(header ? 2 : 1));
        assert.equal(captured.stderr, direct.stderr.repeat(header ? 2 : 1));
        assert.equal(captured.exitCode, expectedStatus);
      }
    } finally { await sh.dispose(); }
  });
}
