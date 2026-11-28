import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const [source, stdout] of [
  ["t='a/b/c'; echo ${t////-}", "a-b-c\n"],
  ['t=\'a/b/c\'; echo "${t////}"', "abc\n"],
  ["p=/usr/local/bin; echo ${p////:}", ":usr:local:bin\n"],
  ["t='a/b/c'; echo ${t//\\//-}", "a-b-c\n"],
  ['t=\'a/b/c\'; echo ${t////-}; echo "${t////}"; p=/usr/local/bin; echo ${p////:}; echo ${t//\\//-}', "a-b-c\nabc\n:usr:local:bin\na-b-c\n"],
  ['t=/a/b; echo "${t///}" "${t///a/x}" "${t//}"', "ab x/b /a/b\n"],
  ['t=/a/b; echo "${t/#//x}" "${t/%//x}"', "/x/a/b /a/b/x\n"],
] as const) {
  test(`literal slash replacement: ${source}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}
