import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

const prelude = 'say() { printf "%s\\n" "$*"; }; ';

for (const pattern of ["*", "a?b", "a*b", "a[!x]b", "a[ab]"]) {
  test(`filename patterns match newlines without ignoring final bytes: ${pattern}`, async () => {
    const files = { "a\nb": "", "aa\n": "", plain: "" };
    const source = `say ${pattern}`;
    const expected = bashResult(prelude + source, { files });
    const { shell, fs } = setup();
    try {
      for (const name of Object.keys(files)) await fs.writeFile(`/${name}`, new Uint8Array());
      const actual = await shell.exec(source);
      assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, {
        stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode,
      });
    } finally { await shell.dispose(); }
  });
}

for (const value of ["a\nb", "a\n", "\na", "\n"]) {
  test(`parameter patterns consume exactly matched newline bytes: ${JSON.stringify(value)}`, async () => {
    const source = `value='${value}'; say "<\${value#?}>|<\${value##?}>|<\${value%?}>|<\${value%%?}>|<\${value##*}>|<\${value%%*}>"`;
    const expected = bashResult(prelude + source);
    const { shell } = setup();
    try {
      const actual = await shell.exec(source);
      assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, {
        stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode,
      });
    } finally { await shell.dispose(); }
  });
}
