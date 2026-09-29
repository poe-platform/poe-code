import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createCsvcutCommands } from "../../src/commands/csvcut/index.js";
import { createCsvgrepCommands } from "../../src/commands/csvgrep/index.js";
import { createLocaleCommands } from "../../src/commands/locale/index.js";

function shell() {
  return new Shell({ fs: new MemoryFileSystem() }).use({ name: "regression", setup(host) {
    for (const command of [...createStandardCommands(), ...createCsvcutCommands(), ...createCsvgrepCommands(), ...createLocaleCommands()]) host.commands.register(command);
  } });
}

for (const [command, expected] of [["csvcut -c 2", "b\n2\n4\n"], ["csvgrep -c 1 -m 1", "a,b\n1,2\n"]]) {
  for (const operand of ["", " -"]) {
    test(`substitution inherits piped stdin: ${command}${operand}`, async () => {
      const result = await shell().exec(`printf 'a,b\\n1,2\\n3,4\\n' | { echo "$( ${command}${operand} )"; }`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    });
  }
  test(`substitution respects here-string and file input: ${command}`, async () => {
    const instance = shell();
    for (const input of ["<<< $'a,b\\n1,2\\n3,4'", "/input.csv", "< /input.csv"]) {
      const result = await instance.exec(`printf 'a,b\\n1,2\\n3,4\\n' > /input.csv; echo "$( ${command} ${input} )"`);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    }
  });
}

for (const env of ['export LC_ALL=C', 'export LANG=""', 'export LC_ALL=C LC_CTYPE=POSIX', 'export LC_ALL="" LANG="" LC_CTYPE=POSIX', 'export LANG=C LC_CTYPE=""']) {
  test(`locale substitution matches direct invocation: ${env}`, async () => {
    const direct = await shell().exec(`${env}; locale`);
    const substitution = await shell().exec(`${env}; echo "$(locale)"`);
    assert.equal(direct.stderr, "");
    assert.equal(substitution.stderr, "");
    assert.equal(substitution.exitCode, direct.exitCode);
    assert.equal(substitution.stdout, direct.stdout);
  });
}
