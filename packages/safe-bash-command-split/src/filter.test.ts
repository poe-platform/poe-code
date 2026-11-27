import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { evalSyncSplit } from "./split.js";

for (const [script, expected] of [
  ["seq 10 | split -l 5 --filter='wc -l'", "5\n5\n"],
  ["seq 4 | split -l 2 --filter='cat > $FILE.txt' - part_; ls", "part_aa.txt\npart_ab.txt\n"],
  ["seq 4 | split -l 2 --filter='echo $FILE'; ls", "xaa\nxab\n"],
  ["seq 4 | split -n 2 --filter='cat'", "1\n2\n3\n4\n"],
  ["seq 4 > input; split -l 2 --filter='cat' input; ls", "1\n2\n3\n4\ninput\n"],
  ["seq 4 | split -l 2 --filter='gzip > $FILE.gz'; gzip -dc xaa.gz xab.gz", "1\n2\n3\n4\n"],
  ["seq 4 | split -b 4 --filter 'cat'", "1\n2\n3\n4\n"],
] as const) {
  test(`split filter: ${script}`, async () => {
    const core = "../../safe-bash/src/core.js";
    const { Shell, agentCommands } = await import(core);
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      if (script.includes("$FILE.txt")) {
        assert.equal(new TextDecoder().decode(await fs.readFile("/work/part_aa.txt")), "1\n2\n");
        assert.equal(new TextDecoder().decode(await fs.readFile("/work/part_ab.txt")), "3\n4\n");
      }
    } finally {
      await shell.dispose();
    }
  });
}

test("sync split defers filters without writing files", () => {
  assert.equal(evalSyncSplit(new TextEncoder().encode("one\n"), ["--filter=cat"], undefined, () => {
    assert.fail("filter must not write a split file");
  }), undefined);
});

test("split stops after a failed filter and preserves the parent FILE", async () => {
  const core = "../../safe-bash/src/core.js";
  const { Shell, agentCommands } = await import(core);
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/" }).use(agentCommands());
  try {
    const result = await shell.exec("FILE=parent; seq 4 | split -l 2 --filter='echo $FILE; exit 7'; status=$?; echo $FILE; exit $status");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "xaa\nparent\n");
    assert.equal(result.stderr, "split: filter exited with status 7\n");
  } finally {
    await shell.dispose();
  }
});
