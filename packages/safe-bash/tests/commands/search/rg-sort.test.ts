import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../../src/index.js";

test("rg accepts none and timestamp sorting in shell pipelines", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("printf 'x\\n' > a; printf 'x\\n' > b; rg --sort none -c x | sort; echo \"rc=${PIPESTATUS[0]}\"; touch -d '2020-01-01' b; rg --sort modified -l x; echo \"rc=$?\"; rg --sort=accessed -c x | sort; rg --sort created -c x | sort");
    assert.equal(result.stdout, "a:1\nb:1\nrc=0\nb\na\nrc=0\na:1\nb:1\na:1\nb:1\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

test("rg sorts directory entries recursively and preserves filters and later defaults", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/a", { recursive: true });
  for (const path of ["a/b", "a/a", "a+", ".hidden", "skip"]) {
    await fs.writeFile(`/work/${path}`, new TextEncoder().encode("x\n"));
  }
  await fs.writeFile("/work/.ignore", new TextEncoder().encode("skip\n"));
  for (const [path, time] of [["a", 3000], ["a+", 2000], ["a/a", 4000], ["a/b", 1000]] as const) {
    await fs.utimes(`/work/${path}`, time, time);
  }
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const [flags, expected] of [
      ["--sort=path", "a/a\na/b\na+\n"],
      ["--sortr=path", "a+\na/b\na/a\n"],
      ["--sort=modified", "a+\na/b\na/a\n"],
      ["--sortr=modified", "a/a\na/b\na+\n"],
      ["--sort=modified -d1", "a+\n"],
      ["--sortr=modified --sort=path", "a/a\na/b\na+\n"],
      ["--sortr=path --sort=none", "a/a\na/b\na+\n"],
      ["", "a/a\na/b\na+\n"],
    ]) {
      const result = await shell.exec(`rg --files ${flags}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected, flags);
    }
  } finally {
    await shell.dispose();
  }
});
