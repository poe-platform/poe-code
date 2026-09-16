import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled shell byte-array foundations", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const command of ["bash /child.sh", "sh /child.sh", "/child.sh"]) {
    test(`public raw arrays survive local restoration and ${command}`, async () => {
      const { Shell, agentCommands } = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const fs = createMemoryFileSystem();
      await fs.writeFile("/child.sh", Buffer.from('#!/bin/bash\nprintf "<%s>" "$@"\n'), { mode: 0o755 });
      const shell = new Shell({ fs }).use(agentCommands());
      try {
        const result = await shell.exec(`a=($'\\xff' $'\\xfe' '�'); f() { local -a a=$'\\xfd'; printf '<%s>' "\${a[@]}"; }; f; ${command} "\${a[@]}"; printf '<%s>' "\${a[@]}"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cfd3e3cff3e3cfe3e3cefbfbd3e3cff3e3cfe3e3cefbfbd3e");
      } finally { await shell.dispose(); }
    });
  }

  test("public read-to-array-to-child preserves raw arg0", async () => {
    const { Shell, agentCommands } = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(255, 10));
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(`IFS= read -r value < /input; a=("$value"); bash -c 'printf "%s" "$0"' "\${a[0]}"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
    } finally { await shell.dispose(); }
  });

  for (const [locale, expected] of [
    ["C", "3c41c3423e3c323e3c323e"],
    ["en_US.UTF-8", "3c41c3a9423e3c323e3c313e"],
  ] as const) {
    test(`public array joins and lengths honor byte identity in ${locale}`, async () => {
      const { Shell, agentCommands } = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
      try {
        const result = await shell.exec(`a=(A B); IFS='é'; printf '<%s>' "\${a[*]}"; a=($'\\xe2\\x82' 'é'); printf '<%s>' "\${#a[0]}" "\${#a[1]}"`, { env: { LC_ALL: locale } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected);
      } finally { await shell.dispose(); }
    });
  }
});
