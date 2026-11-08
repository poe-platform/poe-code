import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const separator of ["@", "*"]) {
  for (const ifs of ["|", ":"]) {
    test(`array ${separator} preserves leading and middle empty fields with IFS=${ifs}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`a=("" head "" tail ""); IFS='${ifs}'; args \${a[${separator}]}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, '["","head","","tail"]');
      assert.equal(result.stderr, "");
    });
  }
  for (const [values, expected] of [
    ['"" tail ""', ["", "tail"]],
    ['head "" tail', ["head", "", "tail"]],
    ['"" "" ""', ["", ""]],
    ['"head|" "|tail"', ["head", "", "", "tail"]],
    ['" head " " tail "', ["head", "tail"]],
  ] as const) {
    test(`array ${separator} preserves aggregate non-whitespace IFS fields: ${values}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`a=(${values}); IFS='| '; args \${a[${separator}]}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, JSON.stringify(expected));
      assert.equal(result.stderr, "");
    });
  }
  test(`array ${separator} still elides empty fields with whitespace IFS`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    assert.equal((await shell.exec(`a=("" tail ""); IFS=' '; args \${a[${separator}]}`)).stdout, '["tail"]');
  });
}

test("quoted array members preserve every empty element", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  assert.equal((await shell.exec('a=("" tail ""); IFS="|"; args "${a[@]}"')).stdout, '["","tail",""]');
  assert.equal((await shell.exec('a=("" tail ""); IFS="|"; args "${a[*]}"')).stdout, '["|tail|"]');
});

for (const command of ["sh", "bash"]) {
  test(`${command} script preserves empty array fields and raw bytes`, async context => {
    const { fs, shell, commands } = setup();
    for (const definition of basicCommands()) commands.register(definition);
    context.after(() => shell.dispose());
    await fs.writeFile("/case.sh", new TextEncoder().encode(`a=("" $'\\xff' ""); IFS='|'; f(){ printf '%s:' "$#"; printf '<%s>' "$@"; }; f \${a[@]}; f \${a[*]}`));
    const result = await shell.exec(`${command} /case.sh`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.from([50, 58, 60, 62, 60, 255, 62, 50, 58, 60, 62, 60, 255, 62]));
  });
}
